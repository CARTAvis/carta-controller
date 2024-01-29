.. _installation:

Installation
============

This section provides a general overview. For a more detailed installation guide, please refer to our step-by-step instructions for :ref:`Ubuntu<focal_instructions>` or :ref:`RPM-based distributions<almalinux8_instructions>`.

.. _install_backend:

Installing the backend
----------------------

We provide `binary Ubuntu packages <https://launchpad.net/~cartavis-team/+archive/ubuntu/carta>`_ of the latest beta and stable releases of the CARTA backend. You can install the latest stable version with all dependencies by adding our PPA to your system and running ``apt-get install carta-backend``.

.. note::

    The ``carta-backend`` package is updated with every stable CARTA release. If you would like to install the latest **beta** version of CARTA, or to receive beta release updates as well as stable release updates in the future, please install the ``carta-backend-beta`` package instead.

.. note::

    The ``casacore-data`` package is recommended by the backend package, but installing it is optional. The packages in our PPA should be compatible both with the ``casacore-data`` package in the core Ubuntu repositories and with the package provided by the `Kern PPAs <https://launchpad.net/~kernsuite>`_. You may also wish to manage the required data files without using a package.

To install the backend on a different host system, or to install a custom version, you can build it from source from the `backend repository <https://github.com/CARTAvis/carta-backend/>`_ on GitHub.

.. _install_frontend:

Installing the frontend
-----------------------

If you install the controller from NPM, the corresponding packaged version of the frontend will also be installed automatically. If you wish to install the controller from source, or would like to use a custom frontend version, you can install it from the `frontend repository <https://github.com/CARTAvis/carta-frontend/>`_ on GitHub.

.. _install_controller:

Installing the controller
-------------------------

You can install the latest stable version of the CARTA controller from NPM by running ``npm install -g carta-controller``, or from GitHub by cloning the `controller repository <https://github.com/CARTAvis/carta-controller/>`_ and running ``npm install``.

.. note::

    If you would like to install the latest **beta** release of CARTA, please install ``carta-controller@beta`` instead.

.. _run_controller:

Running the controller
----------------------

After you have installed the backend and the controller and edited the controller :ref:`configuration<configuration>`, you can start the controller with ``npm run start`` (if installing from the source on GitHub) or just by running ``carta-controller`` (if installing the package from NPM). You can use a utility such as `forever <https://github.com/foreversd/forever>`_ or `pm2 <https://pm2.keymetrics.io/>`_ to keep the controller running. It is also possible to create `a pm2 startup script <https://pm2.keymetrics.io/docs/usage/startup/>`_ which will automatically start the controller when the system is rebooted.
