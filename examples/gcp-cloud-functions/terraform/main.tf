# AgentRun GCP Cloud Functions — all infrastructure in one file.
#
# Provisions: APIs, Service Account, Cloud Storage, Pub/Sub, Firestore,
# Secret Manager secrets, and 4 Cloud Functions (2nd gen).

locals {
  prefix = "agentrun-${var.environment}"

  required_apis = [
    "cloudfunctions.googleapis.com",
    "cloudbuild.googleapis.com",
    "run.googleapis.com",
    "pubsub.googleapis.com",
    "firestore.googleapis.com",
    "secretmanager.googleapis.com",
    "aiplatform.googleapis.com",
    "storage.googleapis.com",
    "eventarc.googleapis.com",
    "eventarcpublishing.googleapis.com",
    "iam.googleapis.com",
  ]
}

# ─── Enable required APIs ────────────────────────────────────────────────────

resource "google_project_service" "apis" {
  for_each = toset(local.required_apis)

  project = var.project_id
  service = each.value

  disable_dependent_services = false
  disable_on_destroy         = false
}

# ─── Service Account ──────────────────────────────────────────────────────────

resource "google_service_account" "runtime" {
  account_id   = "${local.prefix}-runtime"
  display_name = "AgentRun Cloud Functions runtime"
  description  = "Service account used by all AgentRun Cloud Functions"

  depends_on = [google_project_service.apis]
}

# ─── Cloud Storage — Manifests Bucket ─────────────────────────────────────────

resource "google_storage_bucket" "manifests" {
  name                        = "${local.prefix}-manifests"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true

  versioning {
    enabled = false
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = 90
    }
  }
}

resource "google_storage_bucket_iam_member" "manifests_reader" {
  bucket = google_storage_bucket.manifests.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.runtime.email}"
}

# ─── Cloud Storage — Function Source Bucket ───────────────────────────────────

resource "google_storage_bucket" "function_source" {
  name                        = "${local.prefix}-function-source"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true
}

# Placeholder source archive (user replaces with real deployment artifact)
resource "google_storage_bucket_object" "placeholder_source" {
  name   = "placeholder.zip"
  bucket = google_storage_bucket.function_source.name
  source = "${path.module}/placeholder.zip"
}

# ─── Pub/Sub ──────────────────────────────────────────────────────────────────

resource "google_pubsub_topic" "process" {
  name = "${local.prefix}-process"

  message_retention_duration = "86400s" # 24h
}

# ─── Firestore ────────────────────────────────────────────────────────────────

resource "google_firestore_database" "default" {
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  # Prevent accidental deletion
  deletion_policy = "ABANDON"
}

# ─── Secret Manager ──────────────────────────────────────────────────────────

resource "google_secret_manager_secret" "slack_bot_token" {
  secret_id = "${local.prefix}-slack-bot-token"

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

resource "google_secret_manager_secret" "github_token" {
  secret_id = "${local.prefix}-github-token"

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

resource "google_secret_manager_secret" "gchat_service_account" {
  secret_id = "${local.prefix}-gchat-service-account"

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

# Grant the runtime SA access to read secrets
resource "google_secret_manager_secret_iam_member" "slack_token_access" {
  secret_id = google_secret_manager_secret.slack_bot_token.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "github_token_access" {
  secret_id = google_secret_manager_secret.github_token.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "gchat_sa_access" {
  secret_id = google_secret_manager_secret.gchat_service_account.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

# ─── IAM — Additional roles for the runtime service account ──────────────────

# Pub/Sub publisher (events + gchat handlers publish messages)
resource "google_project_iam_member" "pubsub_publisher" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# Firestore read/write (sessions + usage tracking)
resource "google_project_iam_member" "firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# Vertex AI user (LLM calls)
resource "google_project_iam_member" "vertex_ai_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# Cloud Functions invoker (allow Pub/Sub to trigger process function)
resource "google_project_iam_member" "functions_invoker" {
  project = var.project_id
  role    = "roles/cloudfunctions.invoker"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# Cloud Run invoker (2nd gen Cloud Functions run on Cloud Run)
resource "google_project_iam_member" "run_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# ─── Shared environment variables ─────────────────────────────────────────────

locals {
  common_env_vars = {
    GCP_PROJECT_ID                = var.project_id
    GCP_REGION                    = var.region
    PUBSUB_TOPIC                  = google_pubsub_topic.process.name
    AGENTRUN_PACKS                = "default"
    AGENTRUN_SLACK_SECRET         = google_secret_manager_secret.slack_bot_token.secret_id
    AGENTRUN_GITHUB_SECRET        = google_secret_manager_secret.github_token.secret_id
    AGENTRUN_GCHAT_SECRET         = google_secret_manager_secret.gchat_service_account.secret_id
    AGENTRUN_SESSION_TABLE        = "agentrun-sessions"
    AGENTRUN_MANIFESTS_BUCKET     = google_storage_bucket.manifests.name
  }
}

# ─── Cloud Functions (2nd gen) ────────────────────────────────────────────────

# 1. Slack events handler — HTTP trigger
resource "google_cloudfunctions2_function" "events" {
  name     = "${local.prefix}-events"
  location = var.region

  build_config {
    runtime     = "nodejs20"
    entry_point = "eventsHandler"

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.placeholder_source.name
      }
    }
  }

  service_config {
    max_instance_count    = 10
    min_instance_count    = 0
    available_memory      = "256Mi"
    timeout_seconds       = 30
    service_account_email = google_service_account.runtime.email

    environment_variables = local.common_env_vars
  }
}

# Allow unauthenticated invocations (Slack sends webhooks without auth)
resource "google_cloud_run_service_iam_member" "events_public" {
  location = var.region
  service  = google_cloudfunctions2_function.events.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# 2. Google Chat events handler — HTTP trigger
resource "google_cloudfunctions2_function" "gchat" {
  name     = "${local.prefix}-gchat"
  location = var.region

  build_config {
    runtime     = "nodejs20"
    entry_point = "gchatEventsHandler"

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.placeholder_source.name
      }
    }
  }

  service_config {
    max_instance_count    = 10
    min_instance_count    = 0
    available_memory      = "256Mi"
    timeout_seconds       = 30
    service_account_email = google_service_account.runtime.email

    environment_variables = local.common_env_vars
  }
}

# Allow unauthenticated invocations (Google Chat sends webhooks without bearer auth)
resource "google_cloud_run_service_iam_member" "gchat_public" {
  location = var.region
  service  = google_cloudfunctions2_function.gchat.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# 3. Process handler — Pub/Sub trigger
resource "google_cloudfunctions2_function" "process" {
  name     = "${local.prefix}-process"
  location = var.region

  build_config {
    runtime     = "nodejs20"
    entry_point = "processHandler"

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.placeholder_source.name
      }
    }
  }

  service_config {
    max_instance_count    = 5
    min_instance_count    = 0
    available_memory      = "512Mi"
    timeout_seconds       = 300
    service_account_email = google_service_account.runtime.email

    environment_variables = local.common_env_vars
  }

  event_trigger {
    trigger_region = var.region
    event_type     = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic   = google_pubsub_topic.process.id
    retry_policy   = "RETRY_POLICY_RETRY"

    service_account_email = google_service_account.runtime.email
  }
}

# 4. MCP server — HTTP trigger
resource "google_cloudfunctions2_function" "mcp" {
  name     = "${local.prefix}-mcp"
  location = var.region

  build_config {
    runtime     = "nodejs20"
    entry_point = "mcpHandler"

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.placeholder_source.name
      }
    }
  }

  service_config {
    max_instance_count    = 5
    min_instance_count    = 0
    available_memory      = "256Mi"
    timeout_seconds       = 30
    service_account_email = google_service_account.runtime.email

    environment_variables = local.common_env_vars
  }
}

# Allow unauthenticated HTTP access (MCP server handles its own auth via Bearer token)
resource "google_cloud_run_service_iam_member" "mcp_public" {
  location = var.region
  service  = google_cloudfunctions2_function.mcp.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
