const strippedPath = window.location.href.replace(window.location.search, "").replace("/dashboard", "/");
const apiBase = `${strippedPath}api`;
const urlParams = new URLSearchParams(window.location.search);
let redirectUrl;
let autoRedirect = false;
redirectUrl = `${strippedPath}`;
if (urlParams.has("redirectParams")) {
    redirectUrl += atob(urlParams.get("redirectParams"));
    autoRedirect = true;
}

const isPopup = urlParams.get("popup");

let serverCheckHandle;

let authenticationType = "";
let authenticatedUser = "";
let token = "";
let tokenLifetime = -1;
let tokenExpiryTime = -1;
let serverRunning = false;
let notyf;

apiCall = async (callName, jsonBody, method, authRequired) => {
    const options = {
        method: method || "get"
    };
    if (method !== "get" && jsonBody) {
        options.body = JSON.stringify(jsonBody);
        options.headers = {"Content-Type": "application/json"}
    } else {
        options.headers = {};
    }

    if (token) {
        options.headers["Authorization"] = `Bearer ${token}`;
    }

    const currentTime = Date.now() / 1000;
    // If access token expires in under 10 seconds, attempt to refresh before making the call
    if (authRequired && tokenExpiryTime < currentTime + 10) {
        try {
            await refreshLocalToken();
        } catch (e) {
            console.log(e);
        }
    }
    return fetch(`${apiBase}/${callName}`, options);
}

function setToken(tokenString, expiresIn) {
    token = tokenString;
    tokenLifetime = expiresIn;
    if (isFinite(tokenLifetime) && tokenLifetime > 0) {
        console.log(`Token updated and valid for ${tokenLifetime.toFixed()} seconds`);
        const currentTimeSeconds = Date.now() / 1000;
        tokenExpiryTime = currentTimeSeconds + tokenLifetime;
    } else {
        clearToken();
    }
}

function clearToken() {
    console.log("Clearing token");
    token = undefined;
    tokenLifetime = -1;
}

showMessage = (message, error, elementId) => {
    const statusElement = document.getElementById(elementId || "carta-status");

    if (message) {
        statusElement.style.display = "block";
    } else {
        statusElement.style.display = "none";
        return;
    }

    if (error) {
        statusElement.className = "error-message";
    } else {
        statusElement.className = "success-message";
    }
    statusElement.innerHTML = message;
}

setButtonDisabled = (elementId, disabled) => {
    const button = document.getElementById(elementId);
    if (button) {
        button.disabled = disabled;
        if (disabled) {
            button.classList.add("button-disabled");
        } else {
            button.classList.remove("button-disabled")
        }
    }
}

updateServerStatus = async () => {
    let hasServer = false;
    try {
        const res = await apiCall("server/status", {}, "get", true);
        if (res.ok) {
            const body = await res.json();
            if (body.success && body.running) {
                hasServer = true;
            }
        } else if (res.status === 403) {
            console.log("Authentication has been lost");
            await handleLogout();
        }
    } catch (e) {
        console.log(e);
    }
    updateRedirectURL(hasServer);
    serverRunning = hasServer;
}

updateRedirectURL = (hasServer) => {
    if (hasServer) {
        showMessage("CARTA server running", false, "carta-status");
    } else {
        showMessage(`Logged in as ${authenticatedUser}`, false, "carta-status");
    }
}

handleLogin = async () => {
    setButtonDisabled("login", true);
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    const body = {username, password};

    try {
        const res = await apiCall("auth/login", body, "post");
        if (res.ok) {
            const body = await res.json();
            setToken(body.access_token, body.expires_in || Number.MAX_VALUE);

            await onLoginSucceeded(username, "local");
        } else {
            onLoginFailed(res.status);
        }
    } catch (e) {
        onLoginFailed(500);
    }
    setButtonDisabled("login", false);
};

onLoginFailed = (status) => {
    clearToken();
    notyf.error(status === 403 ? "Invalid username/password combination" : "Could not authenticate correctly");
}

onLoginSucceeded = async (username, type) => {
    authenticatedUser = username;
    authenticationType = type;
    localStorage.setItem("authenticationType", type);
    notyf.success(`Logged in as ${authenticatedUser}`);
    if (autoRedirect) {
        handleOpenCarta();
    } else {
        showLoginForm(false);
        showCartaForm(true);
        clearInterval(serverCheckHandle);
        serverCheckHandle = setInterval(updateServerStatus, 5000);
        await updateServerStatus();
    }
}

handleServerStop = async () => {
    try {
        try {
            const res = await apiCall("server/stop", undefined, "post", true);
            const body = await res.json();
            if (body.success) {
                notyf.open({type: "info", message: "Stopped CARTA server successfully"});
                await updateServerStatus();
            } else {
                notyf.error("Failed to stop CARTA server");
                console.log(body.message);
            }
        } catch (e) {
            console.log(e);
        }
    } catch (e) {
        notyf.error("Failed to stop CARTA server");
        console.log(e);
    }
}

handleLogout = async () => {
    localStorage.removeItem("authenticationType");
    if (serverRunning) {
        await handleServerStop();
    }
    window.open(`${apiBase}/auth/logout`, "_self");
}

handleOpenCarta = () => {
    window.open(redirectUrl, "_self");
}

handleLog = async () => {
    // Disable log buttons for 5 seconds
    setButtonDisabled("show-logs", true);
    setButtonDisabled("refresh-logs", true);

    setTimeout(() => {
        setButtonDisabled("show-logs", false);
        setButtonDisabled("refresh-logs", false);
    }, 5000);

    try {
        const res = await apiCall("server/log", undefined, "get", true);
        const body = await res.json();
        if (body.success && body.log) {
            document.getElementById("log-modal").style.display = "block"
            document.getElementById("main-div").classList.add("blurred");
            const outputElement = document.getElementById("log-output");
            if (outputElement) {
                outputElement.innerText = body.log;
                outputElement.scrollTop = outputElement.scrollHeight;
            }
        } else {
            notyf.error("Failed to retrieve backend log");
            console.log(body.message);
        }
    } catch (e) {
        console.log(e);
    }
}

handleHideLog = () => {
    document.getElementById("log-modal").style.display = "none"
    document.getElementById("main-div").classList.remove("blurred");
}

handleLocalLogout = async () => {
    await apiCall("auth/logout", undefined, "post", false);
}

handleKeyup = (e) => {
    if (e.keyCode === 13) {
        const loginButton = document.getElementById("login");
        if (loginButton && !loginButton.disabled) {
            handleLogin();
        }
    }
}

refreshLocalToken = async () => {
    try {
        const res = await apiCall("auth/refresh", {}, "post");
        if (res.ok) {
            const body = await res.json();
            if (body.access_token) {
                setToken(body.access_token, body.expires_in || Number.MAX_VALUE);
            }
        }
    } catch (err) {
        notyf.error("Error refreshing authentication");
        console.log(err);
    }
}

showCartaForm = (show) => {
    const cartaForm = document.getElementsByClassName("carta-form")[0];
    if (show) {
        cartaForm.style.display = "block";
    } else {
        cartaForm.style.display = "none";

    }
}

showLoginForm = (show) => {
    const loginForm = document.getElementsByClassName("login-form")[0];
    if (show) {
        loginForm.style.display = "block";
    } else {
        loginForm.style.display = "none";

    }
}

window.onload = async () => {
    notyf = new Notyf({
        ripple: true,
        position: {x: "center"},
        types: [{
            type: "warning",
            background: "orange"
        }, {
            type: "info",
            background: "#4c84af",
        }]
    });

    // Check for completed login
    const usp = new URLSearchParams(window.location.search);
    if (usp.has("oidcuser")) {
        await refreshLocalToken();
        onLoginSucceeded(usp.get("oidcuser"), "oidc")
    } else if (usp.has("googleuser")) {
        await refreshLocalToken();
        if (localStorage.getItem("redirectParams")) {
            redirectUrl += atob(localStorage.getItem("redirectParams"));
            localStorage.removeItem("redirectParams");
            autoRedirect = true;
        }
        onLoginSucceeded(usp.get("googleuser"), "google")
    } else if (usp.has("err")) {
        console.log(usp.get("err"));
        notyf.open({type: "error", message: usp.get("err")});
    }

    // Store redirectParams in localStorage if using Google login
    if (usp.has("redirectParams") && document.getElementById("g_id_onload")) {
        localStorage.setItem("redirectParams", usp.get("redirectParams"));
    }

    // Hide open button if using popup
    if (isPopup) {
        document.getElementById("open").style.display = "none";
    }
    const existingLoginType = localStorage.getItem("authenticationType");
    if (existingLoginType === "local" || (existingLoginType === "oidc" && !usp.has("oidcuser"))) {
        try {
            const res = await apiCall("auth/refresh", {}, "post");
            if (res.ok) {
                const body = await res.json();
                if (body.access_token) {
                    setToken(body.access_token, body.expires_in || Number.MAX_VALUE);
                    await onLoginSucceeded(body.username, existingLoginType);
                } else {
                    await handleLogout();
                }
            }
        } catch (e) {
            console.log(e);
        }
    }

    // Wire up buttons and inputs
    const loginButton = document.getElementById("login");
    if (loginButton) {
        loginButton.onclick = handleLogin;
    }

    const usernameInput = document.getElementById("username");
    if (usernameInput) {
        usernameInput.onkeyup = handleKeyup;
    }

    const passwordInput = document.getElementById("password");
    if (passwordInput) {
        passwordInput.onkeyup = handleKeyup;
    }

    const oidcLoginButton = document.getElementById("oidcLogin");
    if (oidcLoginButton) {
        oidcLoginButton.onclick = () => { window.location.href = `${apiBase}/auth/login${window.location.search}` };
    }

    document.getElementById("stop").onclick = handleServerStop;
    document.getElementById("open").onclick = handleOpenCarta;
    document.getElementById("show-logs").onclick = handleLog;
    document.getElementById("refresh-logs").onclick = handleLog;
    document.getElementById("hide-logs").onclick = handleHideLog;
    document.getElementById("logout").onclick = handleLogout;

}
