import * as Y from "yjs";
import {WebsocketProvider} from "y-websocket";

const ydoc = new Y.Doc();

// Sync clients with the y-websocket provider
const token = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJjYXJ0YSIsInVzZXJuYW1lIjoiYW5ndXMiLCJpYXQiOjE2OTY4NjMzOTksImV4cCI6MTY5Njg2NDI5OX0.ZLzT-DekUyhScBHq-fuo2dn5pNPcubHuxmB9fQov8e0_lUrfOf2q4msrcuLPCbI7crlmGZDc_3QZHcqmznHxYGNEmHXUyH-Ks16uGaVUPRB_GavLLs5eKoc1QAxnY8uGA66bIHz-2VSuKiOuAhPB7_zeuDliTGXQCcGsDEgYRI_dv1Ho0xpqA0Rku4CBQLmqWBvLk6JbS6bCCZf8YHPVyBf8NYDxkaS4LCGrhAJ_pdZ_24AmbrzK_wAmcUC1Gpm7JfgsBBn-pd3uTM5kN5_6RWBGItQq16tiCpYEHSBTHRA4WF8fZddYu_nNgdSH_sphX1JSrABppOctEOrD_nAWIUavhYoyOrICQ2DypKDX6j4tzER18NUtNCeSCSDXPxCXhz2-r-oQ2G4tAOMSxtZkS5bWq6dGoONxYNcVAGyxuggLYeUZhFC30cV-VBWKG1XKva2z4GZux_FesFpfJlOBpjttsR7BI9ceHjVfystYgl6s9FYn3rmiFpFbCGOPwhPMHcx2PzRXqUdQ5mmxFgQT_Y3Z135a5rWQD6N6CNT0XwapMRtKox9g9CT4_l7v2fe3qcHX1L4HjsogWtECvmX7zX_IRXhfcRN2sdLwZSnDiKLW4Y0NbZTc2JOV-Ezb-RHdjuHkhb6yazxQElNJcgopcCh5j8k5XHna8pVk9Fas6VM";
const websocketProvider = new WebsocketProvider("wss://www.veggiesaurus.net/workspaces/api/collaboration", "count-demo", ydoc, {params: {token}});

// array of numbers which produce a sum
const yarray = ydoc.getArray("count");

// observe changes of the sum
yarray.observe(event => {
    // print updates when the data changes
    console.log("new sum: " + yarray.toArray().reduce((a, b) => a + b));
});

// add 1 to the sum
yarray.push([1]); // => "new sum: 1"


