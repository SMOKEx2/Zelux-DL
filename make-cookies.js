const fs = require('fs');
const path = 'e:\\ProjectCode\\ZELUX-DL\\dist\\cookies.txt';
const cookies = [
    {
        "domain": ".youtube.com",
        "expirationDate": 1796417351.529696,
        "hostOnly": false,
        "httpOnly": true,
        "name": "__Secure-3PSID",
        "path": "/",
        "sameSite": "no_restriction",
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "g.a000-wjx_cjY0jTaU969FuzGPHlazRFgyhZDLfn0zmax0AB81CfxCmAVAIIAEd-bm7Pp2F5yKgACgYKAZsSARcSFQHGX2Mi1PyQDzXyneI2vy6WnTmORxoVAUF8yKotF-5nN4him3bVJLXAvNtM0076"
    },
    {
        "domain": ".youtube.com",
        "expirationDate": 1797519765.105037,
        "hostOnly": false,
        "httpOnly": false,
        "name": "SIDCC",
        "path": "/",
        "sameSite": null,
        "secure": false,
        "session": false,
        "storeId": null,
        "value": "AKEyXzV_1QFzhpcbuNJluqCjF9_E8MbWD5zQplh9bm6wEeBo1bfsXhVVq6jO2uS4flE0zcWjJeY"
    },
    {
        "domain": ".youtube.com",
        "expirationDate": 1796417351.529336,
        "hostOnly": false,
        "httpOnly": false,
        "name": "SID",
        "path": "/",
        "sameSite": null,
        "secure": false,
        "session": false,
        "storeId": null,
        "value": "g.a000-wjx_cjY0jTaU969FuzGPHlazRFgyhZDLfn0zmax0AB81Cfx_3CZTLr8F4XPA0VWcvU2lwACgYKAZYSARcSFQHGX2MiVC2w-0818qNFjwovn_KosRoVAUF8yKoDvrYBmxpXKvcZnrqtlZoN0076"
    },
    {
        "domain": ".youtube.com",
        "expirationDate": 1797519765.104832,
        "hostOnly": false,
        "httpOnly": true,
        "name": "__Secure-1PSIDTS",
        "path": "/",
        "sameSite": null,
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "sidts-CjQByojQU5ltKT2NGxLBFZH27lS68TyB9hnAWz7GYD1fJI-M4iooC2qLtK9cCYEHAdKRBiTUEAA"
    },
    {
        "domain": ".youtube.com",
        "expirationDate": 1796417351.529954,
        "hostOnly": false,
        "httpOnly": false,
        "name": "SAPISID",
        "path": "/",
        "sameSite": null,
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "0IeV4PL5ZnokekrK/APPg3a2PKjN2fL0OQ"
    },
    {
        "domain": ".youtube.com",
        "expirationDate": 1797519765.105095,
        "hostOnly": false,
        "httpOnly": true,
        "name": "__Secure-1PSIDCC",
        "path": "/",
        "sameSite": null,
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "AKEyXzUnWZPPIKrVTkrh3jZtUmcc63Uao-wqq29FQKtDG5vdmVggaeFmkMYL6Gvg7sGGNyqYeQ"
    },
    {
        "domain": ".youtube.com",
        "expirationDate": 1796417351.529824,
        "hostOnly": false,
        "httpOnly": true,
        "name": "SSID",
        "path": "/",
        "sameSite": null,
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "ABEwac8MdJtTxVUL_"
    },
    {
        "domain": ".youtube.com",
        "expirationDate": 1796417351.53002,
        "hostOnly": false,
        "httpOnly": false,
        "name": "__Secure-1PAPISID",
        "path": "/",
        "sameSite": null,
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "0IeV4PL5ZnokekrK/APPg3a2PKjN2fL0OQ"
    },
    {
        "domain": ".youtube.com",
        "expirationDate": 1796417351.529629,
        "hostOnly": false,
        "httpOnly": true,
        "name": "__Secure-1PSID",
        "path": "/",
        "sameSite": null,
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "g.a000-wjx_cjY0jTaU969FuzGPHlazRFgyhZDLfn0zmax0AB81CfxLt39Ou0L2lswOJQU7ogjAgACgYKAVsSARcSFQHGX2MiF_A1l7lQxrgSi7Q0Vme5yhoVAUF8yKoh4A5l-EtIyYSR3Nsy2lGd0076"
    },
    {
        "domain": ".youtube.com",
        "expirationDate": 1796417351.530085,
        "hostOnly": false,
        "httpOnly": false,
        "name": "__Secure-3PAPISID",
        "path": "/",
        "sameSite": "no_restriction",
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "0IeV4PL5ZnokekrK/APPg3a2PKjN2fL0OQ"
    },
    {
        "domain": ".youtube.com",
        "expirationDate": 1797519765.105149,
        "hostOnly": false,
        "httpOnly": true,
        "name": "__Secure-3PSIDCC",
        "path": "/",
        "sameSite": "no_restriction",
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "AKEyXzVcr80N8WTzmoUHaWyYx_9MmbCZJOuXeX12QY2KtHq27_RrgGvHrk5eykny-Uy8-oOigQ"
    },
    {
        "domain": ".youtube.com",
        "expirationDate": 1797519765.104974,
        "hostOnly": false,
        "httpOnly": true,
        "name": "__Secure-3PSIDTS",
        "path": "/",
        "sameSite": "no_restriction",
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "sidts-CjQByojQU5ltKT2NGxLBFZH27lS68TyB9hnAWz7GYD1fJI-M4iooC2qLtK9cCYEHAdKRBiTUEAA"
    },
    {
        "domain": ".youtube.com",
        "expirationDate": 1791144236.258098,
        "hostOnly": false,
        "httpOnly": true,
        "name": "__Secure-BUCKET",
        "path": "/",
        "sameSite": "lax",
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "CNED"
    },
    {
        "domain": ".youtube.com",
        "expirationDate": 1796417351.529886,
        "hostOnly": false,
        "httpOnly": false,
        "name": "APISID",
        "path": "/",
        "sameSite": null,
        "secure": false,
        "session": false,
        "storeId": null,
        "value": "lUdALFc-qfmkFcTy/ATy1izo3SZ1mCV4tw"
    },
    {
        "domain": ".youtube.com",
        "expirationDate": 1796417351.529762,
        "hostOnly": false,
        "httpOnly": true,
        "name": "HSID",
        "path": "/",
        "sameSite": null,
        "secure": false,
        "session": false,
        "storeId": null,
        "value": "AkfWlW8ExLZwdf2Xj"
    },
    {
        "domain": ".youtube.com",
        "expirationDate": 1790878849.284805,
        "hostOnly": false,
        "httpOnly": true,
        "name": "LOGIN_INFO",
        "path": "/",
        "sameSite": "no_restriction",
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "AFmmF2swRQIgMo2x2QVryybIU4HU4g2ihAPvrrsJRsqZx6xBeJcXx1UCIQCYApUh2bw8_txnD0vQMkJ3YikG1SgdEmfnhhtSfrntvg:QUQ3MjNmeWpuWm0wUkZuNnVOalRMaUhQclhtb1ZIcVY2Zm1ENXY2VXZLR2RCU3pzSWtzMzVndEVlNnBEZFp6b0ZjamRSMmhSb3RHRTQtNEVteE90c1ZVSGFvMmtVVm5QR1M5dG1qOWQzTmk5TmsydEFtTDVoZ0NKcVF2bFNNX2xlNDFsQlhLeTRhQmVjUHd3V1ZsRWNfc056UWFfN2Z4WW9n"
    },
    {
        "domain": ".youtube.com",
        "expirationDate": 1797518620.123943,
        "hostOnly": false,
        "httpOnly": false,
        "name": "PREF",
        "path": "/",
        "sameSite": null,
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "tz=Asia.Bangkok&f5=20000&f7=100&f6=40000000"
    }
];

let netscape = '# Netscape HTTP Cookie File\n';
netscape += '# http://curl.haxx.se/rfc/cookie_spec.html\n';
netscape += '# This is a generated file!  Do not edit.\n\n';

cookies.forEach(c => {
    netscape += `${c.domain}\t${c.hostOnly ? 'FALSE' : 'TRUE'}\t${c.path}\t${c.secure ? 'TRUE' : 'FALSE'}\t${Math.floor(c.expirationDate)}\t${c.name}\t${c.value}\n`;
});

fs.writeFileSync(path, netscape);
console.log('Saved cookies.txt to: ' + path);
