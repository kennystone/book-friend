import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";

// Enable Cloud Vision API
const visionApi = new gcp.projects.Service("vision-api", {
  service: "vision.googleapis.com",
  disableOnDestroy: false,
});

// Service account for kindle-scanner
const sa = new gcp.serviceaccount.Account("kindle-scanner-sa", {
  accountId: "kindle-scanner",
  displayName: "Kindle Scanner Service Account",
});

// Grant Vision API access to the service account
new gcp.projects.IAMMember("kindle-scanner-vision-role", {
  project: gcp.config.project!,
  role: "roles/serviceusage.serviceUsageConsumer",
  member: pulumi.interpolate`serviceAccount:${sa.email}`,
}, { dependsOn: [visionApi] });

// Create a key for the service account
const saKey = new gcp.serviceaccount.Key("kindle-scanner-sa-key", {
  serviceAccountId: sa.name,
});

// Export the key (base64-encoded JSON) and service account email
export const serviceAccountEmail = sa.email;
export const serviceAccountKey = saKey.privateKey;
