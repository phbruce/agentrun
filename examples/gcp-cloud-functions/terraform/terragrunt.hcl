# Root Terragrunt config for AgentRun GCP Cloud Functions example.
# Usage: terragrunt apply --var="project_id=my-gcp-project"

generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite"
  contents  = <<EOF
provider "google" {
  project = var.project_id
  region  = var.region
}

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}
EOF
}

generate "variables" {
  path      = "variables.tf"
  if_exists = "overwrite"
  contents  = <<EOF
variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for all resources"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment name (used in resource naming)"
  type        = string
  default     = "prd"
}
EOF
}
