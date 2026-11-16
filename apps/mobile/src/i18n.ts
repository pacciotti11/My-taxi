import { useSyncExternalStore } from "react";

type Locale = "bg" | "en";

const dict = {
  bg: {
    welcome: "Добре дошли в PrivateRide",
    welcomeSub: "Частна транспортна платформа само с покани",
    login: "Вход",
    register: "Регистрация с покана",
    email: "Имейл",
    password: "Парола",
    firstName: "Име",
    lastName: "Фамилия",
    phone: "Телефон (+359...)",
    invitationCode: "Код на поканата",
    acceptTerms: "Приемам условията и политиката за поверителност",
    pendingApproval: "Профилът ви чака одобрение от администратор.",
    whereTo: "Накъде?",
    pickup: "Адрес на тръгване",
    dropoff: "Адрес на пристигане",
    getEstimate: "Виж цена",
    requestRide: "Поръчай курс",
    searching: "Търсим шофьор…",
    driverAssigned: "Шофьорът пътува към вас",
    driverArrived: "Шофьорът пристигна",
    inProgress: "Пътуване в движение",
    completed: "Курсът приключи",
    cancel: "Откажи",
    estimatedFare: "Прогнозна цена",
    finalFare: "Крайна цена",
    goOnline: "Започни смяна",
    goOffline: "Спри смяната",
    online: "На линия",
    offline: "Извън линия",
    offers: "Нови заявки",
    accept: "Приеми",
    reject: "Откажи",
    arrived: "Пристигнах",
    startRide: "Започни курс",
    completeRide: "Завърши курс",
    earnings: "Приходи",
    balance: "Баланс",
    history: "История",
    profile: "Профил",
    home: "Начало",
    driver: "Шофьор",
    logout: "Изход",
    paymentMethods: "Начини на плащане",
    addCard: "Добави карта",
    retryPayment: "Опитай плащането отново",
    receipt: "Разписка",
    error: "Грешка",
  },
  en: {
    welcome: "Welcome to PrivateRide",
    welcomeSub: "Invitation-only private transportation",
    login: "Sign in",
    register: "Register with invitation",
    email: "Email",
    password: "Password",
    firstName: "First name",
    lastName: "Last name",
    phone: "Phone (+359...)",
    invitationCode: "Invitation code",
    acceptTerms: "I accept the terms and privacy policy",
    pendingApproval: "Your account is awaiting administrator approval.",
    whereTo: "Where to?",
    pickup: "Pickup address",
    dropoff: "Dropoff address",
    getEstimate: "Get fare estimate",
    requestRide: "Request ride",
    searching: "Looking for a driver…",
    driverAssigned: "Driver is on the way",
    driverArrived: "Driver has arrived",
    inProgress: "Ride in progress",
    completed: "Ride completed",
    cancel: "Cancel",
    estimatedFare: "Estimated fare",
    finalFare: "Final fare",
    goOnline: "Go online",
    goOffline: "Go offline",
    online: "Online",
    offline: "Offline",
    offers: "Incoming requests",
    accept: "Accept",
    reject: "Reject",
    arrived: "I have arrived",
    startRide: "Start ride",
    completeRide: "Complete ride",
    earnings: "Earnings",
    balance: "Balance",
    history: "History",
    profile: "Profile",
    home: "Home",
    driver: "Driver",
    logout: "Sign out",
    paymentMethods: "Payment methods",
    addCard: "Add card",
    retryPayment: "Retry payment",
    receipt: "Receipt",
    error: "Error",
  },
} as const;

export type TranslationKey = keyof (typeof dict)["bg"];

let current: Locale = "bg";
const listeners = new Set<() => void>();

export function setLocale(locale: Locale): void {
  current = locale;
  for (const l of listeners) l();
}

export function useT(): (key: TranslationKey) => string {
  const locale = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => current,
  );
  return (key) => dict[locale][key];
}

export function formatMoney(minor: number | null | undefined, currency = "BGN"): string {
  if (minor == null) return "—";
  return `${(minor / 100).toFixed(2)} ${currency === "BGN" ? "лв" : "€"}`;
}
