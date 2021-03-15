.. _installation:

Installation options
====================

.. _install_backend:

Installing the backend
----------------------

We provide `binary packages <https://launchpad.net/~confluence/+archive/ubuntu/idia-carta>`_ of the latest development and release versions of the CARTA backend for Ubuntu 20.04 (Focal Fossa). You can install the development version with all dependencies by adding the PPA to your system and running ``apt-get install carta-backend-beta``. Please refer to our :ref:`Ubuntu Focal instructions<focal_instructions>` for more details.

To install the backend on a different host system, or to install a custom version, you can build it from source from the `backend repository <https://github.com/CARTAvis/carta-backend/>`_ on GitHub.

.. _install_frontend:

Installing the frontend
-----------------------

If you install the controller from NPM, the corresponding packaged version of the frontend will also be installed automatically. If you wish to install the controller from source, or would like to use a custom frontend version, you can install it from the `frontend repository <https://github.com/CARTAvis/carta-frontend/>`_ on GitHub.

.. _install_controller:

Installing the controller
-------------------------

You can install the CARTA controller from NPM by running ``npm install -g carta-controller`` and then running ``carta-controller``.

You can also install the controller from GitHub by cloning the `controller repository <https://github.com/CARTAvis/carta-controller/>`_, running ``npm install`` and then ``npm run start``.
