// OpenAI 官方视频 API 形态 → Agnes 私有契约的入站转换。
//
// 双协议支持（owner 裁定）：部分客户端只说 OpenAI 官方视频 API（input[] 数组 /
// instructions / input_reference / duration / aspect_ratio=auto），部分只说
// Agnes 私有形（prompt + mode + size + seconds + first_frame/audios）。
// 网关在入站侧识别 OpenAI 形特征字段，转换为 Agnes 私有形后再走统一白名单；
// Agnes 私有形请求零改动直通。两条协议都到达同一上游，字段语义不变形。
//
// 转换依据（官方文档 + 实测）：
//   - OpenAI 形文本输入：input[].type=="text" → 拼接 prompt；instructions 前置
//   - OpenAI 形图片输入：input[].type=="image" → 首图 first_frame（keyframe）、
//     其余并入 images（reference）；顶层 image 兼容
//   - input_reference：官方五字段历史形 → first_frame（U8 禁止原样透传）
//   - duration："10"（秒）→ seconds="10"（U9：seconds 必须是字符串）
//   - aspect_ratio=auto：上游 400 → 转换器消解为尺寸推导（1K 基准），
//     无尺寸依据时删除该字段由上游默认（16:9）
//   - width/height/num_frames/frame_rate/quality/num_inference_steps：
//     上游 400 forbidden（实测），OpenAI 形若出现，仅做推导换算（如
//     num_frames→seconds），换算不了则剔除并记录，绝不透传
package intent

import (
	"fmt"
	"strconv"
	"strings"
)

// LooksLikeOpenAIVideo 识别 OpenAI 官方视频 API 形态。
// 判据（满足其一）：input 数组 / instructions / input_reference 字段存在。
func LooksLikeOpenAIVideo(source map[string]any) bool {
	if _, ok := source["input"]; ok {
		if _, isArr := source["input"].([]any); isArr {
			return true
		}
	}
	if _, ok := source["instructions"]; ok {
		return true
	}
	if _, ok := source["input_reference"]; ok {
		return true
	}
	return false
}

// openaiVideoToAgnes 把 OpenAI 官方视频 API 形态改写为 Agnes 私有形。
// 返回改写后的 source（原地补齐 prompt/seconds/first_frame/images 等顶层字段，
// 并移除 OpenAI 形专属容器字段），以及转换说明（供日志/响应元信息）。
// 若不识别为 OpenAI 形则原样返回（Agnes 私有形直通路径零开销）。
func openaiVideoToAgnes(source map[string]any) (map[string]any, []string) {
	if !LooksLikeOpenAIVideo(source) {
		return source, nil
	}
	var notes []string

	// ---- 1) input[] → prompt + 媒体 ----
	var promptParts []string
	var images []string
	if input, ok := source["input"].([]any); ok {
		for _, raw := range input {
			part, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			switch asString(part["type"]) {
			case "text":
				if t := asString(part["text"]); t != "" {
					promptParts = append(promptParts, t)
				}
			case "image":
				if img := asString(part["image"]); img != "" {
					images = append(images, img)
				}
			}
		}
	}
	// instructions 前置拼接（O4OpenAI 同口径）
	if ins := asString(source["instructions"]); ins != "" {
		promptParts = append([]string{ins}, promptParts...)
		notes = append(notes, "instructions 已前置拼接到 prompt")
	}
	// prompt 兜底：客户端可能同时给了顶层 prompt（混合形），input 优先
	if len(promptParts) > 0 {
		source["prompt"] = strings.Join(promptParts, "\n")
		notes = append(notes, "input[].text 已拼接为 prompt")
	}

	// ---- 2) 图片输入 → first_frame / images（并按媒体形态定 mode）----
	// 关键：上游 text 模式**禁止携带媒体字段**（实测 400 "text mode cannot
	// include media fields"），所以有图时必须把 mode 定为 keyframe/reference，
	// 否则转换后的请求必 400。mode 已显式给出时尊重客户端。
	if len(images) > 0 {
		if ff, ok := source["first_frame"].(string); !ok || ff == "" {
			source["first_frame"] = images[0]
			if len(images) > 1 {
				source["images"] = images[1:]
			}
			notes = append(notes, "input[].image[0] → first_frame（keyframe 语义）")
		} else {
			existing := toStringSlice(source["images"])
			source["images"] = append(images, existing...)
		}
		if _, hasMode := source["mode"]; !hasMode {
			if len(images) >= 3 {
				source["mode"] = "reference"
				notes = append(notes, "多图（≥3）→ mode=reference")
			} else {
				source["mode"] = "keyframe"
				notes = append(notes, "有图 → mode=keyframe（text 模式禁带媒体）")
			}
		}
	}

	// ---- 3) input_reference（官方五字段历史形）→ first_frame ----
	if ref := asString(source["input_reference"]); ref != "" {
		if _, exists := source["first_frame"]; !exists {
			source["first_frame"] = ref
			notes = append(notes, "input_reference → first_frame（U8 禁止原样透传）")
			if _, hasMode := source["mode"]; !hasMode {
				source["mode"] = "keyframe" // 有首帧即 keyframe，text 模式禁带媒体
				notes = append(notes, "有首帧 → mode=keyframe")
			}
		}
	}

	// ---- 4) duration → seconds（U9：seconds 必须是字符串）----
	if d, ok := source["duration"]; ok {
		if _, exists := source["seconds"]; !exists {
			switch n := d.(type) {
			case string:
				if s := strings.TrimSuffix(strings.TrimSpace(n), "s"); s != "" {
					source["seconds"] = s
					notes = append(notes, "duration → seconds")
				}
			case float64:
				source["seconds"] = strconv.Itoa(int(n))
				notes = append(notes, "duration → seconds")
			}
		}
	}
	// seconds 类型归一：U9 "make sure seconds is a string"（数字/数字串都归一为串）
	if n := intOf(source["seconds"]); n > 0 {
		source["seconds"] = strconv.Itoa(n)
	}

	// ---- 5) aspect_ratio=auto 消解（上游 400）----
	if ar := asString(source["aspect_ratio"]); strings.EqualFold(ar, "auto") {
		// 有像素尺寸依据时推导比例；否则删除字段由上游按模型默认（16:9）
		if w, h := dimsOf(source); w > 0 && h > 0 {
			source["aspect_ratio"] = ratioOf(w, h)
		} else {
			delete(source, "aspect_ratio")
		}
		notes = append(notes, "aspect_ratio=auto 已消解（上游 400）")
	}

	// ---- 6) 像素/帧参数推导或剔除（上游 400 forbidden，绝不透传）----
	if _, exists := source["size"]; !exists {
		if w, h := dimsOf(source); w > 0 && h > 0 {
			source["size"] = videoSizeOf(maxInt(w, h), asString(source["model"]))
			notes = append(notes, fmt.Sprintf("width/height %dx%d → size %s", w, h, source["size"]))
		}
	}
	if nf := intOf(source["num_frames"]); nf > 0 {
		if _, exists := source["seconds"]; !exists {
			source["seconds"] = strconv.Itoa(nf / 24) // 24fps 基准
			notes = append(notes, "num_frames → seconds（24fps 基准）")
		}
	}
	for _, f := range []string{"input", "instructions", "input_reference",
		"width", "height", "num_frames", "frame_rate", "quality", "num_inference_steps"} {
		delete(source, f)
	}
	return source, notes
}

func dimsOf(source map[string]any) (int, int) {
	return intOf(source["width"]), intOf(source["height"])
}

// intOf 宽松取整（数字/数字字符串）。
func intOf(v any) int {
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

// toStringSlice 把 any 归一为 []string（兼容 []any / []string / 单值）。
func toStringSlice(v any) []string {
	switch s := v.(type) {
	case []string:
		return s
	case []any:
		out := make([]string, 0, len(s))
		for _, item := range s {
			if str := asString(item); str != "" {
				out = append(out, str)
			}
		}
		return out
	case string:
		if s != "" {
			return []string{s}
		}
	}
	return nil
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// ratioOf 像素 → 最近比例（支持上游 6 档）。
func ratioOf(w, h int) string {
	r := float64(w) / float64(h)
	switch {
	case r > 1.90:
		return "21:9"
	case r > 1.55:
		return "16:9"
	case r > 1.20:
		return "3:2"
	case r > 0.95:
		return "1:1"
	case r > 0.70:
		return "4:3"
	default:
		return "9:16"
	}
}

// videoSizeOf 长边像素 → 视频 size 档位。
// 官方 U13：agnes-video-2.5-flash 的 size **仅接受 "720P"**（实测
// "size must be 720P"）；agnes-video-2.5 支持 720P/1080P/1K/2K。
// 因此 flash 一律归 720P，其余按长边映射——绝不把图像档位（1K/2K）发给视频端点。
func videoSizeOf(long int, model string) string {
	if strings.Contains(strings.ToLower(model), "flash") {
		return "720P"
	}
	switch {
	case long <= 540:
		return "480P"
	case long <= 800:
		return "720P"
	case long <= 1080:
		return "1080P"
	case long <= 1440:
		return "1K"
	default:
		return "2K"
	}
}
