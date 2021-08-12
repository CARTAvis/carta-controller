import {CartaGoogleAuthConfig, Verifier} from "../types";
import {OAuth2Client} from "google-auth-library";

export const validGoogleIssuers = ["accounts.google.com", "https://accounts.google.com"];

export function generateGoogleVerifier(verifierMap: Map<string, Verifier>, authConf: CartaGoogleAuthConfig) {
    const googleAuthClient = new OAuth2Client(authConf.clientId);
    const verifier = async (cookieString: string) => {
        const ticket = await googleAuthClient.verifyIdToken({
            idToken: cookieString,
            audience: authConf.clientId
        });
        const payload = ticket.getPayload();

        // Use either the email or the unique sub ID as the username
        const username = authConf.useEmailAsId ? payload?.email : payload?.sub;

        // check that username exists and email is verified
        if (!username || !payload?.email_verified) {
            console.log("Google auth rejected due to lack of unique ID or email verification");
            return undefined;
        }

        // check that domain is valid
        if (authConf.validDomain && authConf.validDomain !== payload.hd) {
            console.log(`Google auth rejected due to incorrect domain: ${payload.hd}`);
            return undefined;
        }

        return {...payload, username};
    };

    for (const iss of validGoogleIssuers) {
        verifierMap.set(iss, verifier);
    }
}
