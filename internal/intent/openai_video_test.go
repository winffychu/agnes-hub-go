package intent

import (
	"reflect"
	"testing"
)

// TestOpenAIVideoToAgnes_InputArray OpenAI 官方视频 API 形态（input[] 数组）
// 必须被转换为 Agnes 私有形：text→prompt、image→first_frame、duration→seconds。
func TestOpenAIVideoToAgnes_InputArray(t *testing.T) {
	src := map[string]any{
		"model": "agnes-video-2.5-flash",
		"input": []any{
			map[string]any{"type": "text", "text": "a butterfly in a garden"},
			map[string]any{"type": "image", "image": "https://example.com/f.png"},
		},
		"duration": "5",
	}
	if !LooksLikeOpenAIVideo(src) {
		t.Fatal("input[] 形态应被识别为 OpenAI 形")
	}
	out, notes := openaiVideoToAgnes(src)
	if out["prompt"] != "a butterfly in a garden" {
		t.Errorf("input[].text 应拼接为 prompt，实际 %v", out["prompt"])
	}
	if out["first_frame"] != "https://example.com/f.png" {
		t.Errorf("input[].image 应映射为 first_frame，实际 %v", out["first_frame"])
	}
	if out["seconds"] != "5" {
		t.Errorf("duration 应转为 seconds 字符串，实际 %v", out["seconds"])
	}
	if _, exists := out["input"]; exists {
		t.Error("input 容器字段必须被移除（上游不认）")
	}
	if len(notes) == 0 {
		t.Error("转换说明不应为空（可追溯性）")
	}
}

// TestOpenAIVideoToAgnes_InputReference 官方五字段历史形：input_reference→first_frame。
func TestOpenAIVideoToAgnes_InputReference(t *testing.T) {
	src := map[string]any{
		"model": "agnes-video-2.5-flash", "prompt": "wind blowing",
		"seconds": "4", "size": "720P",
		"input_reference": "https://example.com/ref.png",
	}
	out, _ := openaiVideoToAgnes(src)
	if out["first_frame"] != "https://example.com/ref.png" {
		t.Errorf("input_reference 应映射为 first_frame，实际 %v", out["first_frame"])
	}
	if _, exists := out["input_reference"]; exists {
		t.Error("input_reference 必须被移除（U8 禁止原样透传）")
	}
}

// TestOpenAIVideoToAgnes_ForbiddenFields 上游 400 禁止字段必须被剔除或换算。
func TestOpenAIVideoToAgnes_ForbiddenFields(t *testing.T) {
	src := map[string]any{
		"model": "agnes-video-2.5-flash", "prompt": "x",
		"input": []any{map[string]any{"type": "text", "text": "x"}},
		"width": 1152, "height": 768, "num_frames": 121, "frame_rate": 24,
		"quality": "high", "num_inference_steps": 30,
	}
	out, _ := openaiVideoToAgnes(src)
	for _, f := range []string{"width", "height", "num_frames", "frame_rate", "quality", "num_inference_steps"} {
		if _, exists := out[f]; exists {
			t.Errorf("禁止字段 %s 必须被剔除（上游 400 forbidden）", f)
		}
	}
	// width/height 应被换算为 size（而非丢弃信息）
	if out["size"] == nil {
		t.Error("width/height 应换算为 size 档位")
	}
	// num_frames 应换算为 seconds
	if out["seconds"] == nil {
		t.Error("num_frames 应换算为 seconds")
	}
}

// TestOpenAIVideoToAgnes_AspectRatioAuto aspect_ratio=auto 上游 400，必须消解。
func TestOpenAIVideoToAgnes_AspectRatioAuto(t *testing.T) {
	src := map[string]any{
		"model": "agnes-video-2.5-flash", "prompt": "x",
		"input": []any{map[string]any{"type": "text", "text": "x"}},
		"aspect_ratio": "auto", "width": 1280, "height": 720,
	}
	out, _ := openaiVideoToAgnes(src)
	if out["aspect_ratio"] == "auto" {
		t.Error("aspect_ratio=auto 必须被消解（上游 400）")
	}
	if out["aspect_ratio"] != "16:9" {
		t.Errorf("有像素依据时应推导比例，实际 %v", out["aspect_ratio"])
	}
}

// TestOpenAIVideoToAgnes_AgnesNativePassthrough Agnes 私有形必须零改动直通。
func TestOpenAIVideoToAgnes_AgnesNativePassthrough(t *testing.T) {
	src := map[string]any{
		"model": "agnes-video-2.5-flash", "prompt": "x", "mode": "text",
		"seconds": "4", "size": "720P", "aspect_ratio": "16:9",
	}
	if LooksLikeOpenAIVideo(src) {
		t.Fatal("Agnes 私有形不应被识别为 OpenAI 形")
	}
	out, notes := openaiVideoToAgnes(src)
	if len(notes) != 0 {
		t.Errorf("私有形不应产生转换说明，实际 %v", notes)
	}
	if !reflect.DeepEqual(out, src) {
		t.Error("私有形必须零改动直通")
	}
}

// TestBuildVideoBody_DualProtocol 端到端：两种协议经 BuildVideoBody 后
// 上游收到的字段集合一致（语义等价）。
func TestBuildVideoBody_DualProtocol(t *testing.T) {
	cfg := Config{VideoInputField: "image"}
	// OpenAI 形
	oa := map[string]any{
		"model": "agnes-video-2.5-flash",
		"input": []any{map[string]any{"type": "text", "text": "a red cube"}},
		"duration": "4", "size": "720P", "aspect_ratio": "16:9",
	}
	// Agnes 私有形（等价语义）
	ag := map[string]any{
		"model": "agnes-video-2.5-flash", "prompt": "a red cube",
		"seconds": "4", "size": "720P", "aspect_ratio": "16:9", "mode": "text",
	}
	res := Result{Prompt: Prompt{Text: "a red cube"}}
	outOA := BuildVideoBody(res, "agnes-video-2.5-flash", cfg, oa)
	outAG := BuildVideoBody(res, "agnes-video-2.5-flash", cfg, ag)
	for _, k := range []string{"model", "prompt", "seconds", "size", "aspect_ratio", "mode"} {
		if outOA[k] != outAG[k] {
			t.Errorf("双协议字段 %s 应等价：OpenAI 形=%v 私有形=%v", k, outOA[k], outAG[k])
		}
	}
}
