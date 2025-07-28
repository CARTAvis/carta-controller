# CARTA Controller
<!-- These badges should only be uncommented in release branches, and point to the appropriate tags: -->
<!--[![CARTA version](https://img.shields.io/badge/CARTA%20release-RELEASE-brightgreen)](https://github.com/CARTAvis/carta/releases/tag/vRELEASE)-->
<!--[![npm package](https://img.shields.io/npm/v/carta-controller?style=flat)](https://www.npmjs.com/package/carta-controller/v/RELEASE)-->
<!-- These badges should only be uncommented in dev, and updated with the dev version: -->
[![CARTA backend version](https://img.shields.io/badge/CARTA%20backend%20version-6.0.0--dev-brightgreen)](https://github.com/CARTAvis/carta-backend/)
[![CARTA frontend version](https://img.shields.io/badge/CARTA%20frontend%20version-6.0.0--dev-brightgreen)](https://github.com/CARTAvis/carta-frontend/)
![last commit](https://img.shields.io/github/last-commit/CARTAvis/carta-controller)
![commit activity](https://img.shields.io/github/commit-activity/m/CARTAvis/carta-controller)

The CARTA controller provides a simple dashboard which authenticates users and allows them to manage their CARTA backend processes. It also serves static frontend code to clients, and dynamically redirects authenticated client connections to the appropriate backend processes. The controller can either handle authentication itself, or delegate it to an external OAuth2-based authentication server.

For installation and configuration instructions, and more detailed information about the controller's features, please consult [the full documentation on ReadTheDocs](https://carta-controller.readthedocs.io/en/dev/).

If you encounter a problem with the controller or documentation, please submit an issue in the controller repo. If you need assistance in configuration or deployment, please contact the [CARTA helpdesk](mailto:support@carta.freshdesk.com).
