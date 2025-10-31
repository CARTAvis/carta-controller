.. _installation:

Installation
============

.. note::

    This section provides an overview of different ways to install specific components of CARTA. Please refer to our :ref:`step-by-step instructions <step_by_step>` for a complete set of installation and configuration instructions for supported platforms, and ensure that you have followed all the required steps before running the controller.

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

Packaged debug symbols
~~~~~~~~~~~~~~~~~~~~~~

You can install debugging symbols for our Ubuntu packages with ``apt`` if you enable this option for our PPA.

.. code-block:: shell

    sudo add-apt-repository -c main/debug ppa:cartavis-team/carta
    sudo apt-get install carta-backend-dbgsym

..
    From CARTA v5 beta onwards, debugging symbols can also be installed for our RPM packages.

    .. code-block:: shell

        dnf debuginfo-install carta-backend

Rebuilding packages
~~~~~~~~~~~~~~~~~~~

Our Ubuntu package source is available in `a collection of public repositories <https://github.com/search?q=org%3Aidia-astro+-deb&type=repositories>`_. Please refer to the ``debian`` subdirectories in these repositories if you would like to build your own Debian packages, or to check what build options we use.

You can also obtain the Ubuntu package source with ``apt-src`` (after enabling source packages for our PPA).

.. code-block:: shell

    sudo add-apt-repository -s ppa:cartavis-team/carta
    sudo apt-get update
    sudo apt-get install apt-src
    apt-src install carta-backend

You can obtain the RPM package source with ``dnf``.

.. code-block:: shell

    dnf download --source carta-backend

Custom Casacore version
~~~~~~~~~~~~~~~~~~~~~~~

The backend depends on a custom version of the Casacore C++ library which also includes the image analysis component of CASA. We provide Ubuntu and RPM packages of this dependency in the same repositories as the backend packages. To avoid clashes with the default system Casacore packages, our packages use a different name, and a custom install location, ``/opt/carta-casacore``.

External data for Casacore
~~~~~~~~~~~~~~~~~~~~~~~~~~

Casacore depends on a collection of external astronomical data. Some distributions provide packages for this. Because these packages may be far behind the current version of the data, you may wish to manage the required files without using a package.

The ``casacore-data`` package is recommended by the Ubuntu backend package, but installing it is optional. The packages in `our Ubuntu PPA <https://launchpad.net/~cartavis-team/+archive/ubuntu/carta>`_ should be compatible both with the ``casacore-data`` package in the core Ubuntu repositories and with the package provided by the `Kern PPAs <https://launchpad.net/~kernsuite>`_. To avoid installing the ``casacore-data`` package, use the ``--no-install-recommends`` flag when installing the backend package.

An example script for fetching the data manually (you can configure ``cron`` to run this weekly):

.. code-block:: shell

    #!/bin/bash

    rm -f /tmp/WSRT_Measures.ztar
    wget ftp://ftp.astron.nl/outgoing/Measures/WSRT_Measures.ztar -P /tmp -q

    mkdir -p /var/lib/casacore/data
    tar zxf /tmp/WSRT_Measures.ztar -C /var/lib/casacore/data
    chmod -R 755 /var/lib/casacore/data

Installing from source
~~~~~~~~~~~~~~~~~~~~~~

To install the backend on a different host system, or to install a custom version, you can build it from source from the `backend repository <https://github.com/CARTAvis/carta-backend/>`_ on GitHub. The `dockerfiles <https://github.com/CARTAvis/carta-backend/tree/dev/Dockerfiles>`_ in the backend repository are a good starting point for installing and configuring all the build dependencies on different Linux distributions.

Once all dependencies have been installed, check out the backend repository and all its submodules, and build using ``cmake``.

.. code-block:: shell

    # Clone the backend repository
    git clone https://github.com/CARTAvis/carta-backend.git
    cd carta-backend
    git submodule update --init

    # Configure the build
    mkdir build
    cd build
    cmake ..

    # Build
    make -j8

The backend executable will be located in the ``build`` directory.

.. note::

    If you install a custom backend, ensure that a custom ``processCommand`` is set in the controller configuration and that the backend path is updated in the sudoers file.

.. _install_frontend:

Installing the frontend
-----------------------

If you install the controller package from NPM, the corresponding packaged version of the frontend will be installed automatically as a dependency. However, you may wish to install a custom version of the frontend if you are installing the controller from source, or if you would like to test an updated frontend version.

.. note::

    If you install a custom frontend, ensure that a custom ``frontendPath`` is set in the controller configuration.

NPM package
~~~~~~~~~~~

You can manually install a `specific published version <https://www.npmjs.com/package/carta-frontend>`_ of the frontend `from NPM <https://www.npmjs.com/package/carta-frontend>`_, either globally or into a custom location.

.. code-block:: shell

    # Install latest pre-release version into the current directory
    npm install carta-frontend@dev

Installing from source
~~~~~~~~~~~~~~~~~~~~~~

Development versions of the frontend can be installed from the `frontend repository <https://github.com/CARTAvis/carta-frontend/>`_ on GitHub. Node.js and NPM are required for the build. We recommend performing the WebAssembly compilation in a container. The example below requires Docker to be installed. Please refer to the repository documentation for more compilation options.

.. code-block:: shell

    # Clone the frontend repository
    git clone https://github.com/CARTAvis/carta-frontend.git
    cd carta-frontend
    git submodule update --init

    # Build the frontend (using Docker for WebAssembly compilation)
    npm install
    npm run prepack

The built frontend will be available in the ``build`` subdirectory.

Copying existing build
~~~~~~~~~~~~~~~~~~~~~~

The generated code in the ``build`` directory is standalone and portable between systems. If you already have a build of the frontend in another location, you can safely copy only this directory and use it without having to rebuild it. This may be simpler than setting up a build environment on your server.

The build can be found in ``carta-frontend/build`` in the ``node_packages`` directory created by an NPM install. You can also download tarballs of builds directly from the NPM repository without using ``npm``.

.. _install_controller:

Installing the controller
-------------------------

NPM package
~~~~~~~~~~~

You can install the latest stable version of the CARTA controller from NPM by running ``npm install -g carta-controller``.

.. note::

    If you would like to install the latest **beta** release of CARTA, please install ``carta-controller@beta`` instead.

    If you would like to install the package in a local directory, omit the ``-g`` flag.

Installing from source
~~~~~~~~~~~~~~~~~~~~~~

Development versions of the controller can be installed from the `controller repository <https://github.com/CARTAvis/carta-controller/>`_.

.. code-block:: shell

    # Clone the controller repository
    git clone https://github.com/CARTAvis/carta-controller.git
    cd carta-controller
    git submodule update --init

    # Install the controller
    npm install

.. _run_controller:

Running the controller
----------------------

Executable location
~~~~~~~~~~~~~~~~~~~

The ``carta-controller`` executable can be found

* on the system path, if you installed the NPM package globally
* in ``node_modules/.bin`` and ``node_modules/carta-controller/dist``, if you installed the NPM package locally
* in ``carta-controller/dist``, if you installed from the source directory.

If you installed the controller from source, you can also launch it by running ``npm start`` in the source directory.

Kill script location
~~~~~~~~~~~~~~~~~~~~

The kill script executable path is

* ``/usr/bin/carta-kill-script`` or ``/usr/local/bin/carta-kill-script``, if you installed the NPM package globally (depending on the Node.js distribution)
* ``node_modules/.bin/carta-kill-script``, if you installed the NPM package locally
* ``carta-controller/scripts/carta_kill_script.sh``, if you installed from the source directory.

Ensure that the correct ``killCommand`` is set in the controller configuration, and that the kill script path is correct in the sudoers file.

Persistence
~~~~~~~~~~~

You can use a utility such as `forever <https://github.com/foreversd/forever>`_ or `pm2 <https://pm2.keymetrics.io/>`_ to keep the controller running. It is also possible to create `a pm2 startup script <https://pm2.keymetrics.io/docs/usage/startup/>`_ which will automatically start the controller when the system is rebooted.
