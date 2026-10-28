import "leaflet/dist/leaflet.css";
import "./style.css";
import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import "./lib/theme";

createApp(App).use(router).mount("#app");
