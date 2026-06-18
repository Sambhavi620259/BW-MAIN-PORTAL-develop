import { backendJson } from "./backendClient";

export const paymentApi = {
  async createPayment(payload) {
    return backendJson("/payments/create", { method: "POST", json: payload ?? {} });
  },
};
