// Package pool 负责「模型名 → 池分类（限流桶）」以及「模态 ↔ 池」的换算。
//
// 为什么要有「模态」这一层：agnes-auto 的整个玩法是「客户端不给模型名，
// 由网关判定意图 → 决定模态 → 再从账号声明的模型清单里挑具体模型」。
// 池分类则决定用哪个限流桶（文本池 / 图片各分辨率池 / 视频池）。
package pool

import (
	"regexp"
	"sort"
	"strconv"
	"strings"

	"agneshub/internal/config"
)

// 已知模型清单（内置种子）。
//
// 2026-11-07 起模型清单改为**动态配置驱动**（settings.json 的 free_models /
// dead_models，控制台或手改即可维护，无需改代码重编译）。这里的 var 表只是：
//  1. settings 缺省时的初始种子；
//  2. 兼容旧调用方的最小静态能力（模态判定仍需要一张"名字→模态"映射）。
//
// 免费口径（官方文档核对）：所有 -flash 后缀模型免费；Pro 系与 agnes-video-2.5
// 付费——运行时以 settings.FreeModels 为准，本表不承载"是否免费"语义。
// 死模型（2026-11-07 实测下线）：1.5/2.0 文本、2.5-pro、video-v2.0 已从
// 默认清单与别名**彻底剔除**，运行时以 settings.DeadModels 为准。
var (
	TextModels = map[string]bool{
		"agnes-2.5-flash": true, "agnes-2.0-flash": true, "agnes-1.5-flash": true,
		"agnes-3.0-flash": true, "agnes-2.5-pro": true,
		"agnes-2.5-pro-alpha": true, "agnes-2.5-pro-beta": true,
	}
	ImageModels = map[string]bool{
		"agnes-image-2.0-flash": true, "agnes-image-2.1-flash": true, "agnes-image-2.5-flash": true,
	}
	VideoModels = map[string]bool{
		"agnes-video-v2.0": true, "agnes-video-2.5": true, "agnes-video-2.5-flash": true,
	}
)

// 内置死模型种子（仅当 settings.DeadModels 为空时作兜底；一旦运维在
// settings.json 维护了 dead_models，以配置为准，本种子不再参与判定）。
var builtinDeadModels = map[string]bool{
	"agnes-1.5-flash": true, "agnes-2.0-flash": true, "agnes-2.5-pro": true,
	"agnes-video-v2.0": true,
}

// IsDead 判定模型是否失效。优先 settings.DeadModels（动态可维护），
// 配置为空时回落内置种子（保守兜底）。
func IsDead(model string, dead []string) bool {
	if len(dead) > 0 {
		for _, m := range dead {
			if m == model {
				return true
			}
		}
		return false
	}
	return builtinDeadModels[model]
}

// IsFree 判定模型是否免费（settings.FreeModels 动态配置，不硬编码）。
// 空配置时按官方口径启发式：-flash 后缀免费（与 2026-11-07 文档核对一致）。
func IsFree(model string, free []string) bool {
	for _, m := range free {
		if m == model {
			return true
		}
	}
	if len(free) > 0 {
		return false // 配置了清单就不做启发式，避免口径漂移
	}
	return strings.HasSuffix(strings.ToLower(model), "-flash")
}

// PruneDead 返回剔除死模型后的清单（保持原顺序），用于默认清单/偏好/
// 别名目标在运行时守门——加大剔除力度：任何入口拿到清单先过一遍这里。
func PruneDead(models []string, dead []string) []string {
	out := models[:0:0]
	for _, m := range models {
		if !IsDead(m, dead) {
			out = append(out, m)
		}
	}
	return out
}

// BuiltinAliases 兼容旧客户端的常见别名（控制台 model_aliases 可覆写/追加）。
// 指向已实测下线的 DeadModels 会把请求打进 500 重试循环，全部改指活模型。
var BuiltinAliases = map[string]string{
	"gpt-4o":            "agnes-3.0-flash",
	"gpt-4o-mini":       "agnes-3.0-flash",
	"gpt-4-turbo":       "agnes-3.0-flash",
	"gpt-3.5-turbo":     "agnes-2.5-flash",
	"claude-3-5-sonnet": "agnes-3.0-flash",
	"claude-sonnet-4":   "agnes-3.0-flash",
	"dall-e-3":          "agnes-image-2.5-flash",
	"gpt-image-1":       "agnes-image-2.5-flash",
}

var (
	tierRe = regexp.MustCompile(`(?i)^\s*([1-4])\s*k\s*$`)
	dimRe  = regexp.MustCompile(`(?i)^\s*(\d{2,5})\s*[x×*]\s*(\d{2,5})\s*$`)
)

// tierByLongEdge 长边 → 档位。官方示例：1K/16:9=1312x736，2K/16:9=2624x1472。
var tierByLongEdge = []struct {
	max  int
	tier string
}{{1500, "1k"}, {2800, "2k"}, {3500, "3k"}}

// ModalityByPool 池分类 → 模态。
var ModalityByPool = map[string]string{
	"text":     "text",
	"image_1k": "image", "image_2k": "image", "image_3k": "image", "image_4k": "image",
	"video": "video",
}

// FallbackModel 每个模态的兜底模型（仅在账号清单与偏好都为空时使用）。
var FallbackModel = map[string]string{
	"text":  "agnes-3.0-flash",
	"image": "agnes-image-2.5-flash",
	"video": "agnes-video-2.5-flash",
}

// ResolveModel 把下游传来的模型名解析成上游 agnes 原生模型名。
func ResolveModel(model string, aliases map[string]string) string {
	name := strings.TrimSpace(model)
	if name == "" {
		return ""
	}
	if aliases != nil {
		if v, ok := aliases[name]; ok && v != "" {
			return v
		}
	}
	if v, ok := BuiltinAliases[name]; ok {
		return v
	}
	return name
}

// DetectImageTier 从请求体推断图片档位（1k/2k/3k/4k），拿不准时归入更严的档。
func DetectImageTier(body map[string]any, defaultTier string) string {
	if body != nil {
		if size, ok := body["size"].(string); ok {
			if m := tierRe.FindStringSubmatch(size); m != nil {
				return strings.ToLower(m[1]) + "k"
			}
			if d := dimRe.FindStringSubmatch(size); d != nil {
				w, _ := strconv.Atoi(d[1])
				h, _ := strconv.Atoi(d[2])
				long := w
				if h > long {
					long = h
				}
				for _, t := range tierByLongEdge {
					if long <= t.max {
						return t.tier
					}
				}
				return "4k"
			}
		}
		w := toInt(body["width"])
		h := toInt(body["height"])
		if w > 0 && h > 0 {
			long := w
			if h > long {
				long = h
			}
			for _, t := range tierByLongEdge {
				if long <= t.max {
					return t.tier
				}
			}
			return "4k"
		}
	}
	tier := strings.ToLower(strings.TrimSpace(defaultTier))
	switch tier {
	case "1k", "2k", "3k", "4k":
		return tier
	}
	return "1k"
}

func toInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case string:
		i, err := strconv.Atoi(strings.TrimSpace(n))
		if err != nil {
			return 0
		}
		return i
	}
	return 0
}

// ModalityOfModel 按模型名判定模态；无法判定返回空串。
func ModalityOfModel(model string, aliases map[string]string) string {
	resolved := ResolveModel(model, aliases)
	switch {
	case resolved == "":
		return ""
	case ImageModels[resolved]:
		return "image"
	case VideoModels[resolved]:
		return "video"
	case TextModels[resolved]:
		return "text"
	}
	low := strings.ToLower(resolved)
	if strings.Contains(low, "image") {
		return "image"
	}
	if strings.Contains(low, "video") {
		return "video"
	}
	return ""
}

// Classify 返回池分类：text / image_1k..image_4k / video。
func Classify(model string, body map[string]any, aliases map[string]string, defaultTier string) string {
	resolved := ResolveModel(model, aliases)
	if ImageModels[resolved] {
		return "image_" + DetectImageTier(body, defaultTier)
	}
	if VideoModels[resolved] {
		return "video"
	}
	if TextModels[resolved] {
		return "text"
	}
	low := strings.ToLower(resolved)
	if strings.Contains(low, "image") {
		return "image_" + DetectImageTier(body, defaultTier)
	}
	if strings.Contains(low, "video") {
		return "video"
	}
	return "text"
}

// ModalityOfPool 池分类 → 模态。
func ModalityOfPool(poolClass string) string {
	if m, ok := ModalityByPool[poolClass]; ok {
		return m
	}
	return "text"
}

// PoolForModality 模态 → 池分类（图片按分辨率落桶）。
func PoolForModality(modality string, body map[string]any, defaultTier string) string {
	switch modality {
	case "image":
		return "image_" + DetectImageTier(body, defaultTier)
	case "video":
		return "video"
	default:
		return "text"
	}
}

// ManifestOf 读取账号声明的清单；缺失（nil）时用默认清单补齐。
// 注意：**非 nil 的空切片会被保留**，表示「明示不支持该模态」。
func ManifestOf(a *config.Account, s config.Settings) config.ModelManifest {
	if a.ModelManifest.Text == nil && a.ModelManifest.Image == nil && a.ModelManifest.Video == nil {
		return s.ModelManifestDefault.Clone()
	}
	out := a.ModelManifest.Clone()
	if out.Text == nil {
		out.Text = append([]string(nil), s.ModelManifestDefault.Text...)
	}
	if out.Image == nil {
		out.Image = append([]string(nil), s.ModelManifestDefault.Image...)
	}
	if out.Video == nil {
		out.Video = append([]string(nil), s.ModelManifestDefault.Video...)
	}
	return out
}

// KnownModelNames 返回用于 /v1/models 的模型目录。
func KnownModelNames(aliases map[string]string) []string {
	set := map[string]bool{}
	for m := range TextModels {
		set[m] = true
	}
	for m := range ImageModels {
		set[m] = true
	}
	for m := range VideoModels {
		set[m] = true
	}
	for m := range aliases {
		set[m] = true
	}
	out := make([]string, 0, len(set))
	for m := range set {
		out = append(out, m)
	}
	sort.Strings(out)
	return out
}

// KnownModelNamesByModality 按模态返回已知的模型名（含别名）。
func KnownModelNamesByModality(aliases map[string]string) map[string][]string {
	out := map[string][]string{"text": {}, "image": {}, "video": {}}
	seen := map[string]bool{}
	add := func(name, modality string) {
		name = strings.TrimSpace(name)
		if name == "" {
			return
		}
		key := modality + "|" + name
		if seen[key] {
			return
		}
		seen[key] = true
		out[modality] = append(out[modality], name)
	}

	// 标准模型（Agnes 原生模型）
	for m := range TextModels {
		add(m, "text")
	}
	for m := range ImageModels {
		add(m, "image")
	}
	for m := range VideoModels {
		add(m, "video")
	}

	// 用户自定义别名（控制台 model_aliases 里配置的）
	for alias, target := range aliases {
		if mod := ModalityOfModel(target, aliases); mod != "" {
			add(alias, mod)
		}
	}

	// 注意：不返回 BuiltinAliases（gpt-4o/claude/dall-e-3/gpt-image-1 等），
	// 这些跨厂商兼容别名仅用于 /v1/models 和外部客户端兼容，
	// 聊天 UI 只展示用户实际接入的 Agnes 模型与用户自定义别名。

	for k := range out {
		sort.Strings(out[k])
	}
	return out
}
