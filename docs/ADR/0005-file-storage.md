# 0005. S3 protocol behind a FileStorage port

Date: 2026-10-28 · Status: Accepted

## Context

Uploaded documents, evidence and report PDFs are currently File objects in browser memory. They need durable
storage that is not tied to the database host.

## Decision

Define a `FileStorage` port (`put`, `get`, `signedUrl`, `delete`). Implement it once with
`@aws-sdk/client-s3`. Point it at MinIO locally and at Supabase Storage's S3-compatible endpoint in
production. The database stores only the storage key, size and SHA-256.

## Consequences

- Moving to AWS S3, Cloudflare R2 or another MinIO is a change of endpoint, bucket and keys plus an object copy.
- Downloads go through short-lived signed URLs, so the api never streams large files itself.
- The Supabase Storage SDK is never used.
