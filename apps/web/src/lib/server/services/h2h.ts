import "server-only";
import { H2HError } from "@northeside/core";
import { HttpError } from "../api";

/** Map head-to-head rule errors to HTTP answers. */
export async function h2h<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof H2HError) throw new HttpError(e.code === "not_found" ? 404 : 409, e.code, e.message);
    throw e;
  }
}
