.. CARTA Controller documentation master file, created by
   sphinx-quickstart on Wed Mar 10 15:04:08 2021.
   You can adapt this file completely to your liking, but it should at least
   contain the root `toctree` directive.

CARTA Controller
================

|stable-release| |preview-release| |last-commit| |commit-activity|

`CARTA <https://cartavis.org/>`_ is the Cube Analysis and Rendering Tool for Astronomy. This document describes the installation and configuration process for a site deployment of CARTA, including the controller and its dependencies. We recommend this deployment option for organisations providing CARTA to multiple users.

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

.. |stable-release| image:: https://img.shields.io/npm/v/carta-controller/latest?label=stable%20release
        :alt: Last stable NPM release
        :target: https://www.npmjs.com/package/carta-controller/v/latest

.. |preview-release| image:: https://img.shields.io/npm/v/carta-controller/beta?label=preview%20release
        :alt: Last preview NPM release
        :target: https://www.npmjs.com/package/carta-controller/v/beta

.. |last-commit| image:: https://img.shields.io/github/last-commit/CARTAvis/carta-controller
        :alt: Last dev commit

.. |commit-activity| image:: https://img.shields.io/github/commit-activity/m/CARTAvis/carta-controller
        :alt: Commit activity
