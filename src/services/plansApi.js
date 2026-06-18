import { backendJson } from "./backendClient";

export const plansApi = {
  async getPlans() {
    return backendJson("/plans");
  },
};
