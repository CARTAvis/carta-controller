.. _focal_instructions:

Step-by-step instructions for Ubuntu 22.04 (Jammy Jellyfish) and 24.04 (Noble Numbat)
=====================================================================================

.. note::

    These instructions aim to be a complete guide for installing CARTA for multiple users on a dedicated server, with authentication of local users via PAM, and other simple suggested defaults. If you are integrating CARTA into an existing system, you may need to adjust some of these steps. Please refer to the more detailed :ref:`installation` and :ref:`configuration` instructions for more options.

.. note::

    CARTA version 4.x is supported on Ubuntu 20.04 (Focal Fossa) and 22.04 (Jammy Jellyfish). CARTA version 5.x is supported on Ubuntu 22.04 (Jammy Jellyfish) and 24.04 (Noble Numbat).

    These instructions can be used almost unchanged on Ubuntu 20.04 (Focal Fossa). We note differences where they occur.

Dependencies
------------

Install MongoDB
~~~~~~~~~~~~~~~

We recommend installing the `Community Edition package of MongoDB <https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/>`_ on all supported Ubuntu versions.

.. note::

    There is a ``mongodb`` package available from the official Ubuntu repositories on Ubuntu 20.04 (Focal Fossa). However, this package is older than the Community Edition package, and it has been discontinued in later LTS releases.

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

Please refer to the `detailed MongoDB installation instructions <https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/>`_ for more information.

Install the CARTA backend and other required packages
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Ubuntu packages for CARTA components are available from our `Launchpad PPA <https://launchpad.net/~cartavis-team/+archive/ubuntu/carta>`_.

.. code-block:: shell

    # Add CARTA PPA
    sudo add-apt-repository ppa:cartavis-team/carta
    sudo apt-get update

    # Install the backend package with all dependencies
    sudo apt-get install carta-backend

    # Install additional packages
    sudo apt-get install nginx g++ make curl build-essential

.. note::

    The ``carta-backend`` package is updated with every stable CARTA release. If you would like to install the latest **beta** version of CARTA, or to receive beta release updates as well as stable release updates in the future, please install the ``carta-backend-beta`` package instead:

    .. code-block:: shell

        sudo apt-get install install carta-backend-beta

    These packages cannot be installed simultaneously, as they use the same install locations. If you install one, you will automatically be prompted to uninstall the other.

    Make sure that you install the matching controller version (using the ``beta`` tag).

.. note::

    Please note that Ubuntu packages for CARTA 4.x are only available for Focal and Jammy, and packages for CARTA 5.x are only available for Jammy and Noble.

Install Node.js
~~~~~~~~~~~~~~

We recommend using the `latest LTS version <https://github.com/nodejs/release#release-schedule>`_ of Node.js. The minimum version required for CARTA 5.x is v20. The oldest version known to work with CARTA 4.x is v16. In the example below we install the latest LTS version from the `NodeSource repository <https://github.com/nodesource/distributions>`_.

.. code-block:: shell

    # Install the latest Node.js LTS repo
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -

    # Install Node.js and NPM
    sudo apt-get install -y nodejs

    # Install PM2 process manager
    sudo npm install -g pm2

Install CARTA controller
~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: shell

    # Install carta-controller (includes frontend dependency)
    sudo npm install -g --unsafe-perm carta-controller

.. note::

    If you would like to install the latest **beta** release of CARTA, please install the ``beta`` tag of the controller instead:

    .. code-block:: shell

        sudo npm install -g --unsafe-perm carta-controller@beta

.. note::

    Do not pass the ``--unsafe-perm`` flag to ``npm`` if using a local installation of Node.js.

Configuration
-------------

Set up users and directories
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

All users who should have access to CARTA must belong to a group that identifies them (assumed here to be called ``carta-users``).

For security reasons, we do not recommend running the CARTA controller as the root user. Instead, create a dedicated user called ``carta`` for this purpose. The ``carta`` user should *not* be added to the ``carta-users`` group.

.. code-block:: shell

    # Create a group to identify CARTA users
    sudo groupadd carta-users

    # Create a 'carta' user to run the controller
    sudo adduser --system --home /var/lib/carta --shell=/bin/bash --group carta

    # Create a log directory owned by carta
    sudo mkdir -p /var/log/carta
    sudo chown carta: /var/log/carta

    # Create a config directory owned by carta
    sudo mkdir -p /etc/carta
    sudo chown carta: /etc/carta

Set up permissions
~~~~~~~~~~~~~~~~~~

.. warning::

    If you are using PAM authentication of local users, the ``carta`` user needs read access to the shadow file. This step is not required if you are configuring a different form of user authentication (e.g. LDAP).

.. code-block:: shell

    # Add 'carta' user to the shadow group
    sudo usermod -a -G shadow carta

The ``carta`` user must be given permission to execute the CARTA backend and the script to kill the CARTA backend on behalf of CARTA users using ``sudo`` without providing a password.

.. code-block:: shell

    # Edit sudoers file to grant 'carta' user permission to execute
    # the backend and kill script as any user in `carta-users` group
    sudo visudo -f /etc/sudoers.d/carta_controller

An :ref:`example sudoers configuration<example_sudoers>` is provided in the configuration section. Make sure that the paths to the two executables in the file match their install locations on your system.

Configure Nginx and SSL certificates
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The CARTA controller requires a webserver. We provide instructions for `Nginx <https://www.nginx.com/>`_.

For security reasons, we strongly recommend configuring HTTPS on your server and redirecting all HTTP traffic to HTTPS. We provide instructions for obtaining certificates from `Let's Encrypt <https://letsencrypt.org>`_ using the `Certbot <https://certbot.eff.org/>`_ tool. Certbot will automatically renew your certificates for you. If your organisation can provide you with certificates for your domain, you can skip this step.

.. note::

    Let's Encrypt only issues certificates for publically resolvable domain names, so make sure that you have configured DNS appropriately before this point, and that Nginx is already running.

.. code-block:: shell

    # Install certbot
    sudo apt-get install certbot python3-certbot-nginx

    # Run certbot and follow the prompts to generate the certificates
    sudo certbot certonly --nginx

.. note::

    For simplicity we have provided instructions for installing Certbot from the Ubuntu repositories with ``apt``. However, these packages are far behind the latest version, particularly in older Ubuntu releases. The `official instructions <https://certbot.eff.org/instructions?ws=nginx&os=snap>`_ recommend installation via ``snap``.

Once you have obtained the certificates, edit the Nginx configuration. A :ref:`sample configuration file<example_nginx>` is provided in the configuration section. Adjust the paths to the certificate and the certificate key.

.. code-block:: shell

    # Edit the default Nginx configuration
    sudo vi /etc/nginx/sites-enabled/default

    # Restart Nginx
    sudo systemctl restart nginx

.. _config-controller_rpm:

Configure CARTA controller
~~~~~~~~~~~~~~~~~~~~~~~~~~

The CARTA controller uses SSL keys for authentication.

.. code-block:: shell

    # Switch to carta user
    sudo su - carta

    # Generate private/public keys
    cd /etc/carta
    openssl genrsa -out carta_private.pem 4096
    openssl rsa -in carta_private.pem -outform PEM -pubout -out carta_public.pem

Edit ``/etc/carta/config.json`` to customise the appearance of the dashboard and other controller options. We recommend configuring options for the backend in a separate ``/etc/carta/backend.json`` file.

Please refer to the :ref:`configuration` instructions for more details. We provide sample :ref:`controller<example_config>` and :ref:`backend<example_backend>` configuration files.

Test CARTA controller
~~~~~~~~~~~~~~~~~~~~~

To test that the controller is functioning correctly, use the built-in test feature. You will need at least one user in the `carta-users` group.

.. code-block:: shell

    # Create a test user
    sudo adduser --groups carta-users alice
    sudo passwd alice

    # Switch to 'carta' user
    sudo su - carta

    # Run the controller test
    carta-controller --verbose --test alice

Please refer to the detailed configuration instructions for more information about the :ref:`test feature<test-config>`.

Start CARTA controller
~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: shell

    # Switch to carta user
    sudo su - carta

    pm2 start carta-controller

Configure PM2
~~~~~~~~~~~~~

This service will start the controller automatically after a reboot.

.. code-block:: shell

    # Switch to carta user
    sudo su - carta

    # Generate startup script
    pm2 startup

    # Switch back to user with sudo privileges
    exit

    # Execute the output of the 'pm startup' command

    # Switch back to the 'carta' user
    sudo su - carta

    # Start the controller if it isn't running
    pm2 start carta-controller

    # Save the running process
    pm2 save

Please refer to the `PM2 documentation <https://pm2.keymetrics.io/docs/usage/startup/>`_ for more detailed instructions.
