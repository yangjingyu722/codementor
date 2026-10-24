/** OpenCode 事件类型子集（AgentEvent.type 的镜像，避免跨包类型依赖）。 */
export type AgentEventType =
  'session_start' | 'session_end' | 'tool_call' | 'file_edit' | 'test_run' | 'message' | 'other';
