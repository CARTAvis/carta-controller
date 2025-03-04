.. CARTA Controller documentation master file, created by
   sphinx-quickstart on Wed Mar 10 15:04:08 2021.
   You can adapt this file completely to your liking, but it should at least
   contain the root `toctree` directive.

CARTA Controller
================

|backend-github| |npm-package| |last-commit| |commit-activity|

CARTA is the Cube Analysis and Rendering Tool for Astronomy. This document describes the installation and configuration process for a site deployment of CARTA, including the controller and its dependencies. We recommend this deployment option for organisations providing CARTA to multiple users.

Detailed :ref:`step-by-step instructions <step_by_step>` are provided for a standalone CARTA deployment on a dedicated server. Please use these instructions as a starting point, and make adjustments as required to integrate CARTA into your organisation's existing systems. More detailed information about customisation can be found in the :ref:`installation` and :ref:`configuration` sections.

We officially support Ubuntu 20.04 (v4.x only), 22.04, and 24.04 (v5.x only), and AlmaLinux 8 and 9 (and equivalent RPM-based distributions), with all available standard updates applied. We provide legacy support only for existing 4.x installations on RHEL 7 and equivalents.

.. toctree::
   :maxdepth: 2
   :caption: Contents:

   introduction
   installation
   configuration
   step_by_step
   schema
   schema_backend

.. |backend-github| image:: https://img.shields.io/badge/CARTA%20Version-5.0.0--dev-brightgreen
        :alt: View this backend version on GitHub
        :target: https://github.com/CARTAvis/carta-backend/tree/dev

.. |npm-package| image:: https://img.shields.io/npm/v/carta-controller/dev?style=flat
        :alt: View this project on npm
        :target: https://www.npmjs.com/package/carta-controller/v/5.0.0-beta.1

.. |last-commit| image:: https://img.shields.io/github/last-commit/CARTAvis/carta-controller
        :alt: Last commit

.. |commit-activity| image:: https://img.shields.io/github/commit-activity/m/CARTAvis/carta-controller
        :alt: Commit activity
