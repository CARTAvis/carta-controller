.. CARTA Controller documentation master file, created by
   sphinx-quickstart on Wed Mar 10 15:04:08 2021.
   You can adapt this file completely to your liking, but it should at least
   contain the root `toctree` directive.

CARTA Controller
================

|backend-github| |npm-package| |last-commit| |commit-activity|

CARTA is the Cube Analysis and Rendering Tool for Astronomy. This document describes the installation and configuration process for the controller component.

Detailed step-by-step instructions are provided for :ref:`Ubuntu 20.04 (Focal Fossa)<focal_instructions>` and :ref:`CentOS 8<centos8_instructions>`. 
We officially support Ubuntu 18.04 and 20.04, and RHEL 7 and 8 (and their freely distributed binary-compatible alternatives, such as CentOS or AlmaLinux), with all available standard updates applied.

.. toctree::
   :maxdepth: 2
   :caption: Contents:
   
   introduction
   installation
   configuration
   ubuntu_focal_instructions
   centos8_instructions   
   schema
   schema_backend

.. |backend-github| image:: https://img.shields.io/badge/CARTA%20Version-3.0.0--beta.3-brightgreen
        :alt: View this backend version on GitHub
        :target: https://github.com/CARTAvis/carta-backend/releases/tag/v3.0.0-beta.3

.. |npm-package| image:: https://img.shields.io/npm/v/carta-controller/beta.svg?style=flat
        :alt: View this project on npm
        :target: https://npmjs.org/package/carta-controller

.. |last-commit| image:: https://img.shields.io/github/last-commit/CARTAvis/carta-controller
        :alt: Last commit

.. |commit-activity| image:: https://img.shields.io/github/commit-activity/m/CARTAvis/carta-controller
        :alt: Commit activity
