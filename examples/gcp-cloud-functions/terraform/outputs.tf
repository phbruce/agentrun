# Cloud Function URLs — configure these in Slack and Google Chat console.

output "events_function_url" {
  description = "Slack Events API webhook URL"
  value       = google_cloudfunctions2_function.events.url
}

output "gchat_function_url" {
  description = "Google Chat app endpoint URL"
  value       = google_cloudfunctions2_function.gchat.url
}

output "process_function_name" {
  description = "Process function name (Pub/Sub triggered, no public URL)"
  value       = google_cloudfunctions2_function.process.name
}

output "mcp_function_url" {
  description = "MCP JSON-RPC server URL (for Claude Code CLI)"
  value       = google_cloudfunctions2_function.mcp.url
}

output "service_account_email" {
  description = "Runtime service account email"
  value       = google_service_account.runtime.email
}

output "manifests_bucket" {
  description = "Cloud Storage bucket for AgentRun manifests"
  value       = google_storage_bucket.manifests.name
}

output "pubsub_topic" {
  description = "Pub/Sub topic for async message processing"
  value       = google_pubsub_topic.process.name
}
