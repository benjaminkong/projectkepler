/**
 * Largest COT/TCOT upload. Uploads go browser -> API -> presigned S3 URL (the bucket has no
 * browser CORS), so this is bounded by what the API and its load balancer accept, not S3.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
