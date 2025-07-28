.. CARTA Controller documentation master file, created by
   sphinx-quickstart on Wed Mar 10 15:04:08 2021.
   You can adapt this file completely to your liking, but it should at least
   contain the root `toctree` directive.

CARTA Controller
================

..
        These badges should be uncommented only in the dev branch.
        Don't forget to update the dev version in the definitions below.

|backend-github| |frontend-github| |controller-github| |last-commit| |commit-activity|

..
        These badges should be uncommented only in release branches.
        Don't forget to update the versions and tags in the definitions below.

        |carta-release-github| |npm-package|

CARTA is the Cube Analysis and Rendering Tool for Astronomy. This document describes the installation and configuration process for a site deployment of CARTA, including the controller and its dependencies. We recommend this deployment option for organisations providing CARTA to multiple users.

Detailed :ref:`step-by-step instructions <step_by_step>` are provided for a standalone CARTA deployment on a dedicated server. Please use these instructions as a starting point, and make adjustments as required to integrate CARTA into your organisation's existing systems. More detailed information about customisation can be found in the :ref:`installation` and :ref:`configuration` sections.

We officially support Ubuntu 22.04 and 24.04, and AlmaLinux 8 and 9 (and equivalent RPM-based distributions), with all available standard updates applied.

.. toctree::
   :maxdepth: 2
   :caption: Contents:

   introduction
   installation
   configuration
   step_by_step
   schema
   schema_backend

.. |carta-release-github| image:: https://img.shields.io/badge/CARTA%20release-RELEASE-brightgreen
        :alt: CARTA version
        :target: https://github.com/CARTAvis/carta/releases/tag/vRELEASE

.. |npm-package| image:: https://img.shields.io/npm/v/carta-controller?style=flat
        :alt: NPM package
        :target: https://www.npmjs.com/package/carta-controller/v/RELEASE

.. |backend-github| image:: https://img.shields.io/badge/backend%20version-6.0.0--dev-brightgreen
        :alt: CARTA backend version
        :target: https://github.com/CARTAvis/carta-backend/

.. |frontend-github| image:: https://img.shields.io/badge/frontend%20version-6.0.0--dev-brightgreen
        :alt: CARTA frontend version
        :target: https://github.com/CARTAvis/carta-frontend/

.. |controller-github| image:: https://img.shields.io/badge/controller%20version-6.0.0--dev-brightgreen
        :alt: CARTA controller version
        :target: https://github.com/CARTAvis/carta-controller/

.. |last-commit| image:: https://img.shields.io/github/last-commit/CARTAvis/carta-controller
        :alt: Last commit

.. |commit-activity| image:: https://img.shields.io/github/commit-activity/m/CARTAvis/carta-controller
        :alt: Commit activity
