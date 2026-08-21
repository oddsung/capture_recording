import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import ko from './locales/ko.json'

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ko: { translation: ko }
  },
  // Initial guess from the OS locale; the persisted settings value (also
  // OS-defaulted on first run, user-changeable) takes over once loaded.
  lng: navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

export default i18n
