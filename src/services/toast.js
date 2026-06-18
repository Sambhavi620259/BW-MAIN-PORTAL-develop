import toast from "react-hot-toast";

export const showSuccess = (message) => toast.success(message);
export const showError = (message) => toast.error(message);
