import {CartaOidcAuthConfig, UserMap, Verifier} from "../types";
import {RuntimeConfig} from "../config";
import {watchUserTable} from "./external";
import * as jwt from "jsonwebtoken";
import {JwtPayload} from "jsonwebtoken";
import axios from "axios";
import jwksRsa = require("jwks-rsa");
import { uptime } from "process";
import io = require("@pm2/io");

export async function initialiseOidc(verifierMap: Map<string, Verifier>, userMaps: Map<string, UserMap>, authConf: CartaOidcAuthConfig) {

  let idp_config = await axios.get(authConf.idpUrl + "/.well-known/openid-configuration");

  // need this to log in
  RuntimeConfig.authPath = idp_config.data.authorization_endpoint;

  // need this to get refresh token
  RuntimeConfig.tokenRefreshAddress = idp_config.data.token_endpoint;
  RuntimeConfig.logoutAddress = idp_config.data.end_session_endpoint;
  RuntimeConfig.oidcClientId = authConf.clientId;

  const client = jwksRsa({jwksUri: idp_config.data['jwks_uri']});

  verifierMap.set(idp_config.data.issuer, async (cookieString: string) => {
    let signing_keys = await client.getSigningKeys();

    for (var x in signing_keys) {
      try {
        let payload: any = jwt.verify(cookieString, signing_keys[x].getPublicKey());
        if (payload && payload.iss === idp_config.data.issuer) {
          // Enforce group membership restriction if one is defined
          if (authConf.requiredGroup) {
            if (!authConf.groupsField) {
              console.log("groupsField undefined in config when requiredGroup is specified")
              throw new Error();
            }
            if (!payload[authConf.groupsField].includes(authConf.requiredGroup)) {
              console.log(`Token does not indicate membership in ${authConf.requiredGroup}`);
              throw new Error();
            }
          }

          let username = payload[authConf.uniqueField];

          return {...payload, username};
        }
      } catch (e) {
        //console.log(e)
      }
    }

    return undefined;
  })

  if (authConf.userLookupTable) {
    watchUserTable(userMaps, idp_config.data.issuer, authConf.userLookupTable);
  }

  console.log("Finished configuring OpenID Connect provider")

}
