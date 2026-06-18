import { createContext, useContext, useMemo, useState } from "react";

const STORAGE_KEY = "ui-branding";

const DEFAULT_BRAND = {
  name: "Bold and Wise",
  description: "Bold and wise ventures",
  logoUrl: "/logo.png",
};

const BrandContext = createContext(null);

function getInitialBrand() {
  if (typeof window === "undefined") return DEFAULT_BRAND;

  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) return DEFAULT_BRAND;

  try {
    const parsed = JSON.parse(saved);
    return {
      name: parsed.name || DEFAULT_BRAND.name,
      description: parsed.description || DEFAULT_BRAND.description,
      logoUrl: parsed.logoUrl || DEFAULT_BRAND.logoUrl,
    };
  } catch {
    return DEFAULT_BRAND;
  }
}

export function BrandProvider({ children }) {
  const [brand, setBrandState] = useState(getInitialBrand);

  const setBrand = (value) => {
    setBrandState((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const resetBrand = () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_BRAND));
    setBrandState(DEFAULT_BRAND);
  };

  const value = useMemo(
    () => ({ brand, setBrand, resetBrand, defaultBrand: DEFAULT_BRAND }),
    [brand],
  );

  return (
    <BrandContext.Provider value={value}>{children}</BrandContext.Provider>
  );
}

export function useBrand() {
  const context = useContext(BrandContext);
  if (!context) {
    throw new Error("useBrand must be used inside BrandProvider");
  }
  return context;
}
