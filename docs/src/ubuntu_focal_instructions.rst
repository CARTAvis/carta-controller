.. _focal_instructions:

Step-by-step instructions for Ubuntu 20.04.2 (Focal Fossa)
==========================================================

.. note::

    These instructions can be used almost unchanged on Ubuntu 18.04 (Bionic Badger). We note differences where they occur.

Dependencies
------------

Install the CARTA backend and other required packages
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: shell

    # Add CARTA PPA
    sudo add-apt-repository ppa:cartavis-team/carta
    sudo apt-get update

    # Install the development backend package with all dependencies
    sudo apt-get install carta-backend
    
    # Install additional packages
    sudo apt-get install nginx g++ mongodb make curl

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

    Currently supported versions of NodeJS are v12, v14 and v16. In the example below we install the latest LTS version of NodeJS from the `NodeSource repo <https://github.com/nodesource/distributions>`_. Do not pass the ``--unsafe-perm`` flag to ``npm`` if using a local install.

.. code-block:: shell

    # Install the latest NodeJS LTS repo
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -

    # Install NodeJS, NPM and tools required to compile native addons
    sudo apt-get install -y nodejs build-essential

    # Install carta-controller (includes frontend config)
    sudo npm install -g --unsafe-perm carta-controller@rc
    
    # Install PM2 node service
    sudo npm install -g pm2

    # Switch to carta user
    sudo su - carta
    
    # Generate private/public keys
    cd /etc/carta
    openssl genrsa -out carta_private.pem 4096
    openssl rsa -in carta_private.pem -outform PEM -pubout -out carta_public.pem
    
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

