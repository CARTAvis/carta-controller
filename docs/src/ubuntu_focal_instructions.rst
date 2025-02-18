.. _focal_instructions:

Step-by-step instructions for Ubuntu 22.04 (Jammy Jellyfish) and 24.04 (Noble Numbat)
=====================================================================================

.. note::

    CARTA version 4.x is supported on Ubuntu 20.04 (Focal Fossa) and 22.04 (Jammy Jellyfish).

    These instructions can be used almost unchanged on Ubuntu 20.04 (Focal Fossa). We note differences where they occur.

Dependencies
------------

Install MongoDB
~~~~~~~~~~~~~~~

We recommend installing the [Community Edition package of MongoDB](https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/) on all supported Ubuntu versions.

.. note::

    There is a `mongodb` package available from the official Ubuntu repositories on Ubuntu 20.04 (Focal Fossa). However, this package is older than the Community Edition package, and it has been discontinued in later LTS releases.

.. code-block:: shell

    # Import public key for MongoDB repo
    curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor
    
    # Add MongoDB repository
    echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/8.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
    sudo apt-get update
    
    # Install MongoDB
    sudo apt-get install mongodb-org
    
    # Start MongoDB
    sudo systemctl start mongod
    
    # Make MongoDB start automatically on system restart
    sudo systemctl enable mongod
    
Please refer to the [detailed MongoDB installation instructions](https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/) for more information.

Install the CARTA backend and other required packages
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: shell

    # Add CARTA PPA
    sudo add-apt-repository ppa:cartavis-team/carta
    sudo apt-get update

    # Install the backend package with all dependencies
    sudo apt-get install carta-backend
    
    # Install additional packages
    sudo apt-get install nginx g++ make curl

.. note::
    The ``carta-backend`` package is updated with every stable CARTA release. If you would like to install the latest **beta** version of CARTA, or to receive beta release updates as well as stable release updates in the future, please install the ``carta-backend-beta`` package instead:
    
    .. code-block:: shell
    
        sudo apt-get install install carta-backend-beta
    
    These packages cannot be installed simultaneously, as they use the same install locations. If you install one, you will automatically be prompted to uninstall the other.
    
    Make sure that you install the matching controller version (using the ``beta`` tag).
    
    Please note that Ubuntu packages for the latest stable release (v4.1.0) are only available on Focal and Jammy, and packages for the latest Beta release (v5.0.0-beta.1) are only available on Jammy and Noble.

Set up directories and permissions
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Ensure that all users who should have access to CARTA belong to a group that identifies them (assumed here to be called ``carta-users``).

.. code-block:: shell

    # create a 'carta' user to run the controller
    sudo adduser --system --home /var/lib/carta --shell=/bin/bash --group carta
    
    # add 'carta' user to the shadow group (only required for PAM UNIX authentication)
    sudo usermod -a -G shadow carta

    # log directory owned by carta
    sudo mkdir -p /var/log/carta
    sudo chown carta: /var/log/carta

    # config directory owned by carta
    sudo mkdir -p /etc/carta
    sudo chown carta: /etc/carta

    # edit sudoers file to allow passwordless sudo execution of 
    # /usr/local/bin/carta-kill-script and /usr/bin/carta_backend
    # by the carta user  
    sudo visudo -f /etc/sudoers.d/carta_controller
    
An :ref:`example sudoers configuration<example_sudoers>` is provided in the configuration section.

Configure nginx
~~~~~~~~~~~~~~~

A :ref:`sample configuration file<example_nginx>` is provided in the configuration section. This should be adapted to your server configuration. The relevant part of the config is for forwarding ``/`` to port 8000.

Install CARTA controller
------------------------

.. note::

    We recommend using the `latest LTS version <https://github.com/nodejs/release#release-schedule>`_ of NodeJS. The minimum version required for CARTA 5.x is v20. The oldest version known to work with CARTA 4.x is v16. In the example below we install the latest LTS version from the `NodeSource repo <https://github.com/nodesource/distributions>`_. Do not pass the ``--unsafe-perm`` flag to ``npm`` if using a local install.

.. code-block:: shell

    # Install the latest NodeJS LTS repo
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -

    # Install NodeJS, NPM and tools required to compile native addons
    sudo apt-get install -y nodejs build-essential

    # Install carta-controller (includes frontend config)
    sudo npm install -g --unsafe-perm carta-controller
    
    # Install PM2 node service
    sudo npm install -g pm2

    # Switch to carta user
    sudo su - carta
    
    # Generate private/public keys
    cd /etc/carta
    openssl genrsa -out carta_private.pem 4096
    openssl rsa -in carta_private.pem -outform PEM -pubout -out carta_public.pem
    
.. note::

    If you would like to install the latest **beta** release of CARTA, please install the ``beta`` tag of the controller instead:
    
    .. code-block:: shell
    
        sudo npm install -g --unsafe-perm carta-controller@beta
    
Configure controller
~~~~~~~~~~~~~~~~~~~~
    
Edit ``/etc/carta/config.json`` to customise the appearance of the dashboard and other options. A :ref:`sample configuration file<example_config>` is provided in the configuration section.
    
Run controller
~~~~~~~~~~~~~~

This should be executed as the ``carta`` user.

.. code-block:: shell

    pm2 start carta-controller

Create pm2 startup script
~~~~~~~~~~~~~~~~~~~~~~~~~

This service will start the controller automatically after a reboot. Please refer to the `pm2 documentation <https://pm2.keymetrics.io/docs/usage/startup/>`_ for detailed instructions. You should run ``pm2 startup`` as ``carta``, execute the generated command as a user with ``sudo`` access, and finally run ``pm2 save`` as ``carta`` to save the running controller process.

