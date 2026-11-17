/**
 * Optional Free Firebase Phone Auth (10,000 free SMS OTP/month)
 * Fill in your Firebase Web App config below from https://console.firebase.google.com
 * (Authentication -> Sign-in method -> Phone -> Enable)
 */
window.SOHBA_FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  appId: ""
};

window.SohbaPhoneOTP = {
  isEnabled: function () {
    return Boolean(window.SOHBA_FIREBASE_CONFIG && window.SOHBA_FIREBASE_CONFIG.apiKey);
  }
};
