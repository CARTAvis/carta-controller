const socket = new WebSocket("ws://localhost:8001/api/collaboration/helloworld?token=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJjYXJ0YSIsInVzZXJuYW1lIjoiYW5ndXMiLCJpYXQiOjE2OTY4NjIwMjUsImV4cCI6MTY5Njg2MjkyNX0.hbRQyZ7-3Jl8ZWt_9C9LPpluTObxi5Nne4jGLYaQ75NCDbC1PVO8XF45gjPk7wo9D7kHuLMu6db3uLFbLXp-WVVF5fOtUnviOX_nHkfrbujjF6_gTju__l5zhciPl_rlV2TDuL64UCaBDtOooDx5cFI00eVud5AJO7zgav3hgADl2_QMw79BWKU53tOgLlTemczQPosyhV34nJGJDm6huWYXW4FI3DsOm6vgx3f9UAoftPTaGMjJjMFTmshPf_IsrHGOLlOskTwVHdyvWmH2zvneHOfoEY2BJoHcae5hUQstrU5NPlH7W6PzNmKSePTC00w6x5TzjsAmPOc4SMTErub2Rt24iIp9HzVkZS8O12ZHBx87w_Pwy1Jhjrqh58mG8oGBFelQiPga-eMg8QgPfx_0DleLlOwgVzRax4g7PgJrUD5xl8GzGePekIEFz-hbvxaUKRWJq8FIuSIScIS8nb2ffO41SDjmyR5wPI5J7u8uyCYmQ2f5ITseQJOjwnhzzYxGsjrow6kzRSt0I1Pb6oBE0g0IJynIlyf9ixWyBHxMcetTxWUS9p-KjLqgdPq1qnaTf6JyXQRZZ7wOE4osRrOb4cYpk9eMv225nlc-HQoOJEUurYStYMkAKLryjovJHUtujqo9DkmKglPt2cFdYHruU_-2xnGcc__A2qHRsPQ");
// message is received
socket.addEventListener("message", event => {
    console.log("Message from server ", event.data);
});

// socket opened
socket.addEventListener("open", event => {
    console.log("Message from server ", event);
});

// socket closed
socket.addEventListener("close", event => {
    console.log("Message from server ", event);
});

// error handler
socket.addEventListener("error", event => {
    console.log("Message from server ", event);
});
