import { SHARED_PACKAGE_VERSION, type CalmlyEnv } from "@calmly/shared";

export const SERVER_PLACEHOLDER: { shared: string; env: CalmlyEnv } = {
  shared: SHARED_PACKAGE_VERSION,
  env: "development",
};
