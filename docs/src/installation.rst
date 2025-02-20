.. _installation:

Installation
============

This section provides an overview of different ways to install specific components of CARTA. Please refer to our :ref:`step-by-step instructions <step_by_step>` for a complete set of installation and configuration instructions for supported platforms.

.. _install_backend:

Installing the backend
----------------------

Packages
~~~~~~~~

We provide binary `Ubuntu <https://launchpad.net/~cartavis-team/+archive/ubuntu/carta>`_ and `RPM <https://copr.fedorainfracloud.org/coprs/cartavis/carta>`_ packages of the latest beta and stable releases of the CARTA backend for all officially supported distributions.

You can install the latest stable version with all dependencies on Ubuntu by adding our PPA to your system and running ``apt-get install carta-backend``.

On AlmaLinux you can add our Copr repository and run ``sudo dnf install carta-backend``.

.. note::

    The ``carta-backend`` package is updated with every stable CARTA release. If you would like to install the latest **beta** version of CARTA, or to receive beta release updates as well as stable release updates in the future, please install the ``carta-backend-beta`` package instead.

Rebuilding Ubuntu packages
~~~~~~~~~~~~~~~~~~~~~~~~~~
    
Our Ubuntu package configuration is available in `a collection of public repositories <https://github.com/search?q=org%3Aidia-astro+-deb&type=repositories>`_. Please refer to the ``debian`` subdirectories in these repositories if you would like to build your own Debian packages, or to check what build options we use.
    
External data for Casacore
~~~~~~~~~~~~~~~~~~~~~~~~~~

The backend depends on Casacore, which depends on a collection of external astronomical data. Some distributions provide a packaged version of this data. Because these packages may be far behind the latest version of the data, you may also wish to manage the required files without using a package.

The ``casacore-data`` package is recommended by the Ubuntu backend package, but installing it is optional. The packages in `our Ubuntu PPA <https://launchpad.net/~cartavis-team/+archive/ubuntu/carta>`_ should be compatible both with the ``casacore-data`` package in the core Ubuntu repositories and with the package provided by the `Kern PPAs <https://launchpad.net/~kernsuite>`_. To avoid installing the ``casacore-data`` package, use the ``--no-install-recommends`` flag when installing the backend package.

An example script for fetching the data manually (you can configure ``cron`` to run this weekly):

.. code-block:: shell

    #!/bin/bash

    rm -f /tmp/WSRT_Measures.ztar
    wget ftp://ftp.astron.nl/outgoing/Measures/WSRT_Measures.ztar -P /tmp -q
    tar zxf /tmp/WSRT_Measures.ztar -C /var/lib/casacore/data
    chmod -R 755 /var/lib/casacore/data

Installing from source
~~~~~~~~~~~~~~~~~~~~~~

To install the backend on a different host system, or to install a custom version, you can build it from source from the `backend repository <https://github.com/CARTAvis/carta-backend/>`_ on GitHub. The `dockerfiles <https://github.com/CARTAvis/carta-backend/tree/dev/Dockerfiles>`_ in the backend repository are a good starting point for installing and configuring all the build dependencies on different Linux distributions.

Once all dependencies have been installed, check out the backend repository with all its submodules, and build using ``cmake``.

.. code-block:: shell

    # Clone the backend repository
    git clone --recurse-submodules https://github.com/CARTAvis/carta-backend.git
    cd carta-backend

    # Configure the build
    mkdir build
    cd build
    cmake ..
    
    # Build
    make -j8

.. _install_frontend:

Installing the frontend
-----------------------

If you install the controller from NPM, the corresponding packaged version of the frontend will also be installed automatically. If you wish to install the controller from source, or would like to use a custom frontend version, you can install it from the `frontend repository <https://github.com/CARTAvis/carta-frontend/>`_ on GitHub.

The generated code in the ``build`` directory is standalone and portable between systems. If you have already built a custom frontend from source in another location, or installed it from a package, you can safely copy only this directory and use it without having to rebuild it.

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
