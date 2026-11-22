import { createRouter, createWebHashHistory } from "vue-router";
import { getSid } from "./api";
import { state } from "./store";

const routes = [
  { path: "/login", name: "login", component: () => import("./views/LoginView.vue"), meta: { public: true } },
  { path: "/", name: "home", component: () => import("./views/HomeView.vue"), meta: { tab: "home" } },
  { path: "/bills", name: "bills", component: () => import("./views/BillsView.vue"), meta: { tab: "bills" } },
  { path: "/paycode", name: "paycode", component: () => import("./views/PayCodeView.vue"), meta: { tab: "paycode" } },
  { path: "/me", name: "me", component: () => import("./views/MeView.vue"), meta: { tab: "me" } },
  { path: "/water", name: "water", component: () => import("./views/WaterView.vue") },
  { path: "/recharge", name: "recharge", component: () => import("./views/RechargeView.vue") },
  { path: "/electric", name: "electric", component: () => import("./views/ElectricView.vue") },
  { path: "/card", name: "card", component: () => import("./views/CardView.vue") },
  { path: "/bind", name: "bind", component: () => import("./views/BindView.vue") },
  { path: "/payitems", name: "payitems", component: () => import("./views/PayItemsView.vue") },
  { path: "/notice/:id", name: "notice", component: () => import("./views/NoticeView.vue") },
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach((to) => {
  const authed = Boolean(getSid()) && Boolean(state.user);
  if (!to.meta.public && !authed) {
    return { path: "/login", query: to.fullPath !== "/" ? { next: to.fullPath } : undefined };
  }
  if (to.path === "/login" && authed) return { path: "/" };
  return true;
});
