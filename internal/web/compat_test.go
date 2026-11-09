package web

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"agneshub/internal/config"
)

// ---------------------------------------------------------------------------
// 接口兼容性回归（对应 docs/API-COMPATIBILITY.md §4 清单的 R1/R2/R4/R5）
// ---------------------------------------------------------------------------

// R1: /v1/messages 的错误必须是 Anthropic 结构（anthropic-sdk 才能解析出原因）。
func TestAnthropicErrorShape(t *testing.T) {
	h := newHarness(t, 0, 1)

	req, _ := http.NewRequest(http.MethodPost, h.ts.URL+"/v1/messages",
		strings.NewReader(`{"model":"agnes-2.5-flash","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer sk-wrong-key")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("请求失败: %v", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
	var body struct {
		Type  string `json:"type"`
		Error struct {
			Type    string `json:"type"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("body 非 JSON: %v (%s)", err, raw)
	}
	if body.Type != "error" {
		t.Errorf("顶层 type = %q, want \"error\"（Anthropic 结构）", body.Type)
	}
	if body.Error.Type != "authentication_error" {
		t.Errorf("error.type = %q, want authentication_error", body.Error.Type)
	}
}

// R2: /v1/responses 明确 501（上游无此端点），OpenAI 错误体 + 替代端点指引。
func TestResponsesEndpointReturns501(t *testing.T) {
	h := newHarness(t, 0, 1)

	resp, out := h.post("/v1/responses", map[string]any{
		"model": "agnes-2.5-flash", "input": "hi",
	})
	if resp.StatusCode != http.StatusNotImplemented {
		t.Fatalf("responses = %d, want 501", resp.StatusCode)
	}
	errObj, _ := out["error"].(map[string]any)
	if errObj == nil {
		t.Fatalf("缺 error 对象: %v", out)
	}
	if errObj["code"] != "unsupported_endpoint" {
		t.Errorf("code = %v, want unsupported_endpoint", errObj["code"])
	}
	if msg, _ := errObj["message"].(string); !strings.Contains(msg, "/v1/chat/completions") {
		t.Errorf("message 应含替代端点指引: %q", msg)
	}
}

// R4/R5: 视频对象基础键 + GET 列表 + DELETE（不依赖上游排队，直接构造任务）。
func TestVideoObjectKeysListAndDelete(t *testing.T) {
	h := newHarness(t, 0, 1)

	for _, id := range []string{"job_a", "job_b", "job_c"} {
		h.store.PutJob(&config.VideoJob{
			JobID: id, VideoID: "vid_" + id, Model: "agnes-video-2.5-flash",
			AccountID: "acc_x", Status: "submitted", CreatedAt: 1700000000,
		})
	}

	// R5: 列表
	req, _ := http.NewRequest(http.MethodGet, h.ts.URL+"/v1/videos", nil)
	req.Header.Set("Authorization", "Bearer "+h.apiKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("list 请求失败: %v", err)
	}
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list = %d, want 200", resp.StatusCode)
	}
	var list struct {
		Object string           `json:"object"`
		Data   []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		t.Fatalf("list body 非 JSON: %v (%s)", err, raw)
	}
	if list.Object != "list" || len(list.Data) != 3 {
		t.Fatalf("list = object:%s n:%d, want list/3", list.Object, len(list.Data))
	}
	first := list.Data[0]
	for _, k := range []string{"id", "object", "status", "model", "created_at"} {
		if _, ok := first[k]; !ok {
			t.Errorf("列表项缺基础键 %q: %v", k, first)
		}
	}
	if first["object"] != "video" {
		t.Errorf("object = %v, want video", first["object"])
	}
	if first["id"] == nil || first["id"] == "" {
		t.Errorf("id 缺失: %v", first)
	}

	// R5: 删除
	req2, _ := http.NewRequest(http.MethodDelete, h.ts.URL+"/v1/videos/job_b", nil)
	req2.Header.Set("Authorization", "Bearer "+h.apiKey)
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatalf("delete 请求失败: %v", err)
	}
	raw2, _ := io.ReadAll(resp2.Body)
	resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("delete = %d, want 200", resp2.StatusCode)
	}
	var del map[string]any
	_ = json.Unmarshal(raw2, &del)
	if del["deleted"] != true || del["id"] != "job_b" {
		t.Errorf("delete resp = %v", del)
	}

	// 删除后列表少一条
	req3, _ := http.NewRequest(http.MethodGet, h.ts.URL+"/v1/videos", nil)
	req3.Header.Set("Authorization", "Bearer "+h.apiKey)
	resp3, _ := http.DefaultClient.Do(req3)
	raw3, _ := io.ReadAll(resp3.Body)
	resp3.Body.Close()
	_ = json.Unmarshal(raw3, &list)
	if len(list.Data) != 2 {
		t.Errorf("删除后条数 = %d, want 2", len(list.Data))
	}

	// R5: 删除未知 id → 404
	req4, _ := http.NewRequest(http.MethodDelete, h.ts.URL+"/v1/videos/job_missing", nil)
	req4.Header.Set("Authorization", "Bearer "+h.apiKey)
	resp4, _ := http.DefaultClient.Do(req4)
	resp4.Body.Close()
	if resp4.StatusCode != http.StatusNotFound {
		t.Errorf("delete 未知 id = %d, want 404", resp4.StatusCode)
	}

	// 未鉴权 → 401
	req5, _ := http.NewRequest(http.MethodGet, h.ts.URL+"/v1/videos", nil)
	resp5, _ := http.DefaultClient.Do(req5)
	resp5.Body.Close()
	if resp5.StatusCode != http.StatusUnauthorized {
		t.Errorf("未鉴权 list = %d, want 401", resp5.StatusCode)
	}
}
