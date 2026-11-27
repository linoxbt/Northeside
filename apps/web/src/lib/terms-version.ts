/**
 * The Terms version players accept. One constant: it never depends on a build flag (audit 27 Nov,
 * FE-8). Bump it for every material change; players who accepted an older version are asked again
 * before they can seal. Its own module so client code does not pull in the legal texts.
 */
export const TERMS_VERSION = "1.4";
