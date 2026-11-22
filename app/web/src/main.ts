import { createApp } from "vue";
import { router } from "./router";
import App from "./App.vue";
import "./styles/base.css";
import { boot } from "./store";

async function main() {
  const app = createApp(App);

  // 先恢复会话，再安装路由：否则首次导航时 state.user 仍为空，守卫会把所有深链重定向到 /login
  await boot();

  app.use(router);
  await router.isReady();
  app.mount("#app");
}

main();
