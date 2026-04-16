---
name: media-storage-flow
description: Apply Hanuja Cloudflare R2 media storage rules. Use when implementing file upload, image optimization, CDN URL generation, access control, or media asset management.
user-invocable: false
paths:
  - "api/services/media*"
  - "api/routes/upload*"
  - "api/routes/media*"
  - "packages/ui/src/**/image*"
  - "apps/seller-panel/src/**/upload*"
model: sonnet
effort: medium
---

This skill defines Hanuja media storage discipline.

Main principle:
Cloudflare R2 is the approved object storage. All media access must be controlled. Raw upload filenames must never be trusted directly.

Supported media types:
- Product images (seller-uploaded)
- Store/seller avatar and banner
- Blog post featured images (admin-uploaded)
- Admin-uploaded evidence (for disputes)
- Category icons or banners (admin-uploaded)

Upload flow:
1. Client requests presigned upload URL from API (POST /api/upload/presign)
2. API validates auth + permission + file type + size limit
3. API generates presigned R2 URL with short TTL
4. Client uploads directly to R2 via presigned URL
5. Client sends upload confirmation to API (POST /api/upload/confirm)
6. API verifies file exists in R2, creates MediaAsset record
7. Returns public CDN URL to client

File validation rules:
- Allowlist: jpg, jpeg, png, webp (for images)
- Max size: 10MB per image (configurable)
- Validate MIME type server-side, not only extension
- Reject executable extensions regardless of MIME
- Never trust client-provided filename — generate safe storage key
- Storage key pattern: {entity_type}/{entity_id}/{uuid}.{ext}

Image optimization:
- Use Cloudflare Images transform URLs or worker for resizing
- Standard sizes: thumbnail (150x150), card (400x400), detail (800x800), hero (1200x900)
- WebP preferred for delivery
- Original preserved in R2 for re-processing if needed

CDN URL rules:
- Never expose raw R2 bucket URL to public
- Route through Cloudflare CDN domain
- Public media uses public CDN URL (products, stores, blog)
- Private/evidence media uses signed URL with TTL (dispute evidence)

MediaAsset record must capture:
- id
- uploader_id (user who uploaded)
- uploader_role
- entity_type (product, store, blog_post, dispute_evidence)
- entity_id (nullable until assigned)
- original_filename (for reference only)
- storage_key (R2 key)
- cdn_url
- mime_type
- file_size_bytes
- width, height (for images)
- status (PENDING, ACTIVE, DELETED)
- created_at

Access control:
- Product images: public (no auth required)
- Store images: public
- Dispute evidence: admin + involved seller only via signed URL
- Upload endpoints: require auth + role check

When implementing media logic:
- never build upload that trusts client filename directly
- always validate file type server-side
- use presigned upload pattern for large files
- generate CDN URLs, not raw storage URLs
- test unauthorized access to evidence files

Never accept:
- directly serving raw R2 bucket URLs to public
- trusting client-provided filenames for storage paths
- no size/type validation
- media upload without auth check
- sensitive files accessible without authorization
