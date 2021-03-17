.. _focal_instructions:

Step-by-step instructions for Ubuntu 20.04.2 (Focal Fossa)
==========================================================

Dependencies
------------

Install the CARTA backend and other required packages
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: shell

    # Add CARTA PPA
    sudo add-apt-repository ppa:cartavis-team/carta
    sudo apt-get update

    # Install the development backend package with all dependencies
    sudo apt-get install carta-backend-beta
    
    # Install additional packages
    sudo apt-get install nginx curl g++ mongodb

Set up directories and permissions
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Ensure that all users who should have access to CARTA belong to a group that identifies them (assumed here to be called ``carta-users``).

.. code-block:: shell

    # create a 'carta' user to run the controller
    sudo adduser --disabled-login --gecos "" carta

    # log directory owned by carta
    sudo mkdir -p /var/log/carta
    sudo chown carta: /var/log/carta

    # config directory owned by carta
    sudo mkdir -p /etc/carta
    sudo chown carta: /etc/carta

    # edit sudoers file to allow passwordless sudo execution of 
    # /usr/local/bin/carta_kill_script.sh and /usr/bin/carta_backend
    # by the carta user  
    sudo visudo -f /etc/sudoers.d/carta_controller
    
An :ref:`example sudoers configuration<example_sudoers>` is provided in the configuration section.

Configure nginx
~~~~~~~~~~~~~~~

A :ref:`sample configuration file<example_nginx>` is provided in the configuration section. This should be adapted to your server configuration. The relevant part of the config is for forwarding ``/`` to port 8000.

Install CARTA controller
------------------------

.. code-block:: shell

    # Most of these commands should be executed as the carta user
    sudo su - carta

    # Install NVM and NPM
    cd ~
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.37.2/install.sh | bash
    source .bashrc
    nvm install --lts
    nvm install-latest-npm

    # Install carta-controller (includes frontend config)
    npm install -g carta-controller@dev
    
    # For security reasons, copy the kill script to a system bin directory
    cp ${NVM_BIN}/../lib/node_modules/carta-controller/scripts/carta_kill_script.sh ~
    exit
    sudo mv /home/carta/carta_kill_script.sh /usr/local/bin/
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

.. code-block:: shell

    # Install PM2 node service
    npm install -g pm2
    pm2 start carta-controller
