(() => {
  "use strict";

  // Add the GA4 web stream's Measurement ID here (for example, G-ABC123DEF4).
  // Until a valid ID is present, Google Analytics and the consent banner stay disabled.
  const GA_MEASUREMENT_ID = "G-8JTPTPR1NW";
  const LIVE_HOST = "skybluemcee.github.io";
  const CONSENT_KEY = "skyblue_google_analytics_consent_v1";
  const CONSENT_REGION_KEY = "skyblue_google_analytics_region_v1";
  const CONSENT_REGION_API = "https://skyblue-world-settings-counters.world-settings-counters.workers.dev/api/analytics-region";
  const banner = document.querySelector("[data-analytics-consent]");
  const manageButton = document.querySelector("[data-analytics-consent-manage]");
  const acceptButton = document.querySelector("[data-analytics-consent-accept]");
  const declineButton = document.querySelector("[data-analytics-consent-decline]");

  if (
    document.documentElement.dataset.analytics === "off" ||
    location.hostname !== LIVE_HOST ||
    !/^G-[A-Z0-9]+$/.test(GA_MEASUREMENT_ID) ||
    !banner ||
    !manageButton ||
    !acceptButton ||
    !declineButton
  ) return;

  let analyticsLoaded = false;

  const readChoice = () => {
    try { return localStorage.getItem(CONSENT_KEY); }
    catch { return null; }
  };

  const saveChoice = (choice) => {
    try { localStorage.setItem(CONSENT_KEY, choice); }
    catch { /* The choice will apply only to this page if storage is blocked. */ }
  };

  const readConsentRegion = () => {
    try {
      const value = sessionStorage.getItem(CONSENT_REGION_KEY);
      if (value === "required") return true;
      if (value === "not-required") return false;
    } catch { /* Check Cloudflare again if session storage is unavailable. */ }
    return null;
  };

  const saveConsentRegion = (required) => {
    try {
      sessionStorage.setItem(
        CONSENT_REGION_KEY,
        required ? "required" : "not-required"
      );
    } catch { /* A failed cache only causes another region check next page. */ }
  };

  const getConsentRegion = async () => {
    const cached = readConsentRegion();
    if (cached !== null) return cached;

    try {
      const response = await fetch(CONSENT_REGION_API, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        cache: "no-store"
      });
      if (!response.ok) return null;

      const result = await response.json();
      if (typeof result.requiresConsent !== "boolean") return null;
      saveConsentRegion(result.requiresConsent);
      return result.requiresConsent;
    } catch {
      return null;
    }
  };

  const setBannerOpen = (open) => {
    banner.hidden = !open;
    if (open) acceptButton.focus();
  };

  const removeAnalyticsCookies = () => {
    document.cookie.split(";").forEach((entry) => {
      const name = entry.split("=")[0].trim();
      if (name === "_ga" || name.startsWith("_ga_")) {
        document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
      }
    });
  };

  const loadAnalytics = () => {
    if (analyticsLoaded) return;
    analyticsLoaded = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };

    window.gtag("consent", "default", {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied"
    });
    window.gtag("consent", "update", { analytics_storage: "granted" });
    window.gtag("set", "ads_data_redaction", true);

    const tag = document.createElement("script");
    tag.async = true;
    tag.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
    document.head.append(tag);

    window.gtag("js", new Date());
    window.gtag("config", GA_MEASUREMENT_ID, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });
  };

  const declineAnalytics = () => {
    saveChoice("declined");
    if (window.gtag) {
      window.gtag("consent", "update", {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied"
      });
    }
    removeAnalyticsCookies();
    setBannerOpen(false);
  };

  acceptButton.addEventListener("click", () => {
    saveChoice("accepted");
    setBannerOpen(false);
    loadAnalytics();
  });
  declineButton.addEventListener("click", declineAnalytics);
  manageButton.addEventListener("click", () => setBannerOpen(true));

  const initializeAnalytics = async () => {
    const choice = readChoice();
    const consentRequired = await getConsentRegion();

    if (consentRequired === true) {
      manageButton.hidden = false;
      if (choice === "accepted") loadAnalytics();
      else if (choice !== "declined") setBannerOpen(true);
      return;
    }

    // Respect a previous explicit decision even if the visitor later changes
    // region. If geolocation fails with no prior choice, fail closed: do not
    // load Google Analytics and do not bother the visitor with a guess.
    if (choice === "accepted") {
      manageButton.hidden = false;
      loadAnalytics();
    } else if (choice === "declined") {
      manageButton.hidden = false;
    } else if (consentRequired === false) {
      loadAnalytics();
    }
  };

  initializeAnalytics();
})();
