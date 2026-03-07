# AI Remote Orchestrator (OpenClaw-like System)

## Product Requirements Document (PRD)

------------------------------------------------------------------------

## 1. Project Overview

### 1.1 Purpose

This system enables users to remotely instruct AI agents (Codex or
Claude Code) via a web dashboard.\
A cloud server acts as a message broker and control center, while a
local Mac-based AI Agent executes tasks such as code modification, PR
generation, and document creation.

### 1.2 Core Goals

-   Chat-based task instruction
-   Selectable AI engine (Codex / Claude Code)
-   Automatic code modification and PR creation
-   Document generation and artifact storage
-   Real-time execution log streaming
-   Reliable job persistence and retry handling

------------------------------------------------------------------------

## 2. System Architecture

### 2.1 Components

#### Cloud (OCI ARM VM)

-   Dashboard Server (Web UI + REST API)
-   WebSocket Broker Server
-   PostgreSQL Database

#### Local (Mac Agent)

-   Persistent WebSocket connection to cloud broker
-   AI execution engine (Codex or Claude Code)
-   Git automation (branch, commit, PR)
-   Log streaming back to broker

------------------------------------------------------------------------

## 3. Authentication & Authorization

### 3.1 Dashboard Authentication

-   Google OAuth login
-   Email allowlist validation
-   Session-based access control

### 3.2 Agent Authentication

-   Agent Key issued from dashboard
-   Secure key hashing on server
-   Key revocation & regeneration support
-   Heartbeat-based online status tracking

------------------------------------------------------------------------

## 4. Functional Requirements

### 4.1 Job Management

-   Create Job (code or document)
-   Select AI engine (Codex / Claude Code)
-   Attach prompt and optional input data
-   View job status and execution logs
-   Cancel job (if running)
-   Retry failed job

### 4.2 Job Types

#### Code Job

-   Repository selection
-   Branch creation via worktree
-   AI execution for modification
-   Test execution (optional)
-   Commit and push
-   Pull Request generation

#### Document Job

-   AI-based content generation
-   Markdown artifact storage
-   Result preview and download

------------------------------------------------------------------------

## 5. Job Lifecycle

Statuses: - queued - assigned - running - succeeded - failed - canceled

Transitions: - queued → assigned - assigned → running - running →
succeeded / failed - assigned (timeout) → queued (reassign)

------------------------------------------------------------------------

## 6. WebSocket Protocol

### Agent → Server

-   AUTH
-   HEARTBEAT
-   JOB_ACK
-   JOB_STATUS
-   JOB_LOG
-   JOB_RESULT

### Server → Agent

-   AUTH_OK / AUTH_FAIL
-   JOB_ASSIGN
-   JOB_CANCEL

------------------------------------------------------------------------

## 7. Database Schema (Conceptual)

### users

-   id
-   email
-   created_at

### agents

-   id
-   name
-   agent_key_hash
-   capabilities (json)
-   status
-   last_heartbeat_at

### jobs

-   id
-   type (code/doc)
-   engine (codex/claude_code)
-   repo (nullable)
-   prompt
-   inputs (json)
-   status
-   assigned_agent_id
-   locked_at
-   timestamps

### job_events

-   id
-   job_id
-   type (status/log/result)
-   payload (json)
-   created_at

------------------------------------------------------------------------

## 8. Non-Functional Requirements

-   HTTPS / WSS enforced
-   Agent outbound-only connection
-   Job persistence via database
-   Automatic job reassignment on agent failure
-   Secure secret management (no plaintext key storage)
-   Rate limiting for dashboard endpoints

------------------------------------------------------------------------

## 9. MVP Scope

Phase 1: - Google login - Job creation UI - Agent registration -
WebSocket connection - Job assignment - Log streaming - Result storage

Phase 2: - PR auto-creation - Job retry mechanism - Artifact history
filtering - Multi-agent support

------------------------------------------------------------------------

## 10. Success Criteria

-   User can create a job from dashboard
-   Local agent receives and executes job
-   Logs stream in real time
-   Result stored and viewable
-   PR created successfully (for code job)
-   System survives agent disconnect and reassigns safely
