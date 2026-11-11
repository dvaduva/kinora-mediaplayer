import { configureApi, getApiConfig } from "@kinora/client";
import { loadConnection, type Connection } from "./connection";

configureApi(loadConnection());

export function setConnection(next: Connection) {
  configureApi(next);
}

export function getConnection(): Connection {
  return getApiConfig();
}

export { api, createSession, setUnauthorized } from "@kinora/client";
