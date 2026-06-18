/**
 * Legacy `apiClient` paths — prefer `backendApis.js` + `backendJson` for real backend routes:
 * GET `/dashboard/summary`, GET `/dashboard/transactions`, GET `/activity/my`, GET `/notifications/my`, GET `/profile`.
 */
export const endpoints = {
  auth: {
    login: "/login",
    verifyOtp: "/verify-otp",
    register: "/register",
    registerIndividual: "/auth/register/individual",
    registerOrganization: "/auth/register/organization",
  },
  admin: {
    dashboard: "/admin/dashboard",
    users: "/admin/users",
    userStatus: (id) => `/admin/users/${id}/status`,
    apps: "/admin/apps",
    appById: (id) => `/admin/apps/${id}`,
    payments: "/admin/payments",
    /** Prefer kycAdminBackend — canonical GET `/kyc/all` */
    kyc: "/kyc/all",
    kycStatus: (id) => `/kyc/${id}/status`,
    tickets: "/tickets/admin",
    ticketStatus: (id) => `/tickets/status/${id}`,
    ticketReply: (id) => `/tickets/reply/${id}`,
    activity: "/activity/admin",
  },
  /**
   * Legacy axios paths — prefer `applicationBackend` + `backendJson`:
   * GET `/application/list`, GET `/application/my`.
   */
  apps: {
    all: "/apps",
    myApps: "/apps/my",
    favorites: "/apps/favorites",
    toggleSubscription: (id) => `/apps/${id}/subscription`,
    toggleFavorite: (id) => `/apps/${id}/favorite`,
  },
  users: {
    list: "/users",
    byId: (id) => `/users/${id}`,
  },
  tickets: {
    all: "/tickets",
    byId: (id) => `/tickets/${id}`,
    create: "/tickets",
    /** PUT body e.g. { status } */
    update: (id) => `/tickets/${id}`,
    updateStatus: (id) => `/tickets/${id}`,
    reply: (id) => `/tickets/${id}/reply`,
  },
  profile: {
    me: "/profile/me",
    update: "/profile/me",
    uploadPhoto: "/profile/me/photo",
  },
  settings: {
    me: "/settings/me",
  },
  plans: {
    all: "/plans",
  },
  payment: {
    create: "/payments/create",
  },
};
