const backendUrl = import.meta.env.VITE_API_URL?.trim();

// VITE_API_URL points at the generation endpoint; the chat endpoint lives next
// to it on the same backend, so swap the last segment when it is overridden.
const chatUrlFor = (dalleUrl) => (/\/dalle\/?$/.test(dalleUrl) ? dalleUrl.replace(/dalle\/?$/, 'chat') : null);

const development = {
  backendUrl: backendUrl || "http://localhost:8080/api/v1/dalle",
};
const production = {
  backendUrl: backendUrl || "/api/v1/dalle",
};
development.chatUrl = chatUrlFor(development.backendUrl) || "http://localhost:8080/api/v1/chat";
production.chatUrl = chatUrlFor(production.backendUrl) || "/api/v1/chat";

const config = { development, production };

export default config;
