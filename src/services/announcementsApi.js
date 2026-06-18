import { backendJson, backendMultipart } from "./backendClient";
import {
  normalizeAnnouncement,
  normalizeAnnouncementList,
  toAnnouncementApiPayload,
} from "../utils/announcements";

const QUIET = { suppressGlobalServerErrorToast: true };

export const announcementsApi = {
  async listActive() {
    const res = await backendJson("/announcements/active", {
      method: "GET",
      ...QUIET,
    });
    return normalizeAnnouncementList(res).filter((row) => row.published !== false);
  },

  async listAdmin() {
    const res = await backendJson("/admin/announcements", {
      method: "GET",
      ...QUIET,
    });
    return normalizeAnnouncementList(res);
  },

  async create(payload) {
    const res = await backendJson("/admin/announcements", {
      method: "POST",
      json: toAnnouncementApiPayload(payload),
      ...QUIET,
    });
    return normalizeAnnouncement(res?.data ?? res) ?? res;
  },

  async update(id, payload) {
    const res = await backendJson(
      `/admin/announcements/${encodeURIComponent(String(id))}`,
      {
        method: "PATCH",
        json: toAnnouncementApiPayload(payload),
        ...QUIET,
      },
    );
    return normalizeAnnouncement(res?.data ?? res) ?? res;
  },

  async remove(id) {
    return backendJson(
      `/admin/announcements/${encodeURIComponent(String(id))}`,
      {
        method: "DELETE",
        ...QUIET,
      },
    );
  },

  async uploadAsset(id, file) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("banner", file);
    return backendMultipart(
      `/admin/announcements/${encodeURIComponent(String(id))}/assets`,
      fd,
      { method: "POST", suppressGlobalServerErrorToast: true },
    );
  },
};
