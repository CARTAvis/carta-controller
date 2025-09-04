.. _step_by_step:

Step-by-step instructions for a complete deployment
===================================================

.. _sbs_overview:

Overview
--------

.. note::

    These instructions aim to be a complete guide for installing CARTA for multiple users on a dedicated server, with authentication of local users via PAM, and other simple suggested defaults. If you are integrating CARTA into an existing system, you may need to adjust some of these steps. Please refer to the more detailed :ref:`installation` and :ref:`configuration` instructions for more options.

.. tabs::

    .. tab:: Ubuntu

        .. note::

            CARTA version 5.x is supported on Ubuntu 22.04 (Jammy Jellyfish) and 24.04 (Noble Numbat). The Ubuntu instructions should also work on equivalent Ubuntu-based distributions, and may work with some adjustments on other Debian-based distributions and non-LTS Ubuntu releases.

    .. tab:: AlmaLinux

        .. note::

            CARTA version 5.x is supported on AlmaLinux 8 and 9. The AlmaLinux instructions should also work on other equivalent RPM-based distributions.

.. _sbs_prerequisites:

Prerequisites
~~~~~~~~~~~~~

These instructions assume that you are logged in as an ordinary user with passwordless ``sudo`` access. Ubuntu server images have a default ``ubuntu`` user configured with these privileges. On AlmaLinux this user is called ``almalinux``.

We assume that your shell is ``bash``. ``curl`` and ``vim`` must be installed.

.. tabs::

    .. tab:: Ubuntu

        .. code-block:: shell

            sudo apt-get install vim curl

    .. tab:: AlmaLinux

        .. code-block:: shell

            sudo dnf install vim curl

We include instructions for configuring SSL in your webserver. This requires either a domain name and certificates provided by your organisation, or a domain from a provider compatible with Let's Encrypt (or your preferred certificate authority). Domain name setup is outside the scope of this document.

.. _sbs_dependencies:

Install dependencies
--------------------

.. _sbs_mongo:

Install MongoDB
~~~~~~~~~~~~~~~

.. tabs::

    .. tab:: Ubuntu

        We recommend installing the `Community Edition Debian package of MongoDB <https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/>`_ on all supported Ubuntu versions.

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

    .. tab:: AlmaLinux

        We recommend installing the `Community Edition RPM package of MongoDB <https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-red-hat/>`_ on all supported RPM-based distributions. These are instructions for installing version 8.0, which is available on AlmaLinux 8 and 9.

        .. code-block:: shell

            # Add MongoDB repository
            sudo bash -c 'cat > /etc/yum.repos.d/mongodb-org.repo' << 'EOF'
            [mongodb-org-8.0]
            name=MongoDB Repository
            baseurl=https://repo.mongodb.org/yum/redhat/$releasever/mongodb-org/8.0/$basearch/
            gpgcheck=1
            enabled=1
            gpgkey=https://www.mongodb.org/static/pgp/server-8.0.asc
            EOF

            sudo dnf update

            # Install MongoDB:
            sudo dnf install mongodb-org

            # Start MongoDB
            sudo systemctl start mongod

            # Make MongoDB start automatically on system restart
            sudo systemctl enable mongod

Please refer to the `detailed MongoDB installation instructions <https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/>`_ for more information.

.. _sbs_packages:

Install CARTA backend and other required packages
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. tabs::

    .. tab:: Ubuntu

        Ubuntu packages for CARTA components are available from our `Launchpad PPA <https://launchpad.net/~cartavis-team/+archive/ubuntu/carta>`_.

        .. code-block:: shell

            # Add CARTA PPA
            sudo add-apt-repository ppa:cartavis-team/carta
            sudo apt-get update

            # Install the backend package with all dependencies
            sudo apt-get install carta-backend

            # Install additional packages
            sudo apt-get install g++ make build-essential libpam0g-dev

        .. note::

            The ``carta-backend`` package is updated with every stable CARTA release. If you would like to install the latest **beta** version of CARTA, or to receive beta release updates as well as stable release updates in the future, please install the ``carta-backend-beta`` package instead:

            .. code-block:: shell

                sudo apt-get install carta-backend-beta

            These packages cannot be installed simultaneously, as they use the same install locations. If you install one, you will automatically be prompted to uninstall the other.

            Make sure that you install the matching controller version (using the ``beta`` tag).

    .. tab:: AlmaLinux

        RPM packages of the CARTA backend are available from our `Copr repository <https://copr.fedorainfracloud.org/coprs/cartavis/carta/>`_.

        .. code-block:: shell

            # Install EPEL repository
            sudo dnf install epel-release

            # Install the CARTA backend
            sudo dnf install 'dnf-command(copr)'
            sudo dnf copr enable cartavis/carta
            sudo dnf install carta-backend

            # Install additional packages

            sudo dnf install python3 make gcc-c++ pam-devel

        .. note::

            A minimum Python version of 3.8 is required to build the controller. On AlmaLinux 8, install the ``python38`` or ``python39`` package instead. If multiple versions are installed, you must reconfigure the default.

            .. code-block:: shell

                sudo dnf install python38
                sudo update-alternatives --config python3

            Follow the prompts, and check that the default version is correct: ``python3 --version``.
                
        .. note::

            The ``carta-backend`` package is updated with every stable CARTA release. If you would like to install the latest **beta** version of CARTA, or to receive beta release updates as well as stable release updates in the future, please install ``carta-backend-beta`` instead:

            .. code-block:: shell

                sudo dnf install carta-backend-beta

            We currently install the beta version of the backend package in a non-standard location, ``/opt/carta-beta``. This makes it possible to install the stable and beta packages simultaneously. When you use this package, remember to change the path to the backend executable to ``/opt/carta-beta/bin/carta_backend`` in both the sudoers file and the controller configuration.

            Make sure that you install the matching controller version (using the ``beta`` tag).

.. _sbs_node:

Install Node.js
~~~~~~~~~~~~~~~

We recommend installing the `latest LTS version <https://github.com/nodejs/release#release-schedule>`_ of Node.js (currently v22) from the `NodeSource repository <https://github.com/nodesource/distributions>`_. The minimum version required for CARTA 5.x is v20.

.. tabs::

    .. tab:: Ubuntu

        .. code-block:: shell

            # Install the latest Node.js LTS repo
            curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -

            # Install Node.js (includes NPM)
            sudo apt-get install nodejs

    .. tab:: AlmaLinux

        .. code-block:: shell

            # Install the latest Node.js LTS repo
            curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo -E bash -

            # Install Node.js (includes NPM)
            sudo dnf install nodejs

        .. note::

            Node.js and NPM can also be installed from the AlmaLinux AppStream repository on AlmaLinux 8 and 9. This version of ``npm`` installs executables into ``/usr/local/bin``. If you use it, be sure to update the kill script path in the sudoers file and controller configuration.

            .. code-block:: shell

                # Install Node.js and NPM
                sudo dnf module enable nodejs:22
                sudo dnf install nodejs npm

.. _sbs_install_controller:

Install CARTA controller
------------------------

.. code-block:: shell

    # Install carta-controller (includes frontend dependency)
    sudo npm install -g --unsafe-perm carta-controller

.. note::

    If you would like to install the latest **beta** release of CARTA, please install the ``beta`` tag of the controller instead:

    .. code-block:: shell

        sudo npm install -g --unsafe-perm carta-controller@beta

.. note::

    Do not pass the ``--unsafe-perm`` flag to ``npm`` if using a custom installation of Node.js in a local directory.

.. _sbs_system_config:

System configuration
--------------------

.. _sbs_users_dirs:

Set up users and directories
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

All users who should have access to CARTA must belong to a group that identifies them (assumed here to be called ``carta-users``).

For security reasons, we do not recommend running the CARTA controller as the root user. Instead, create a dedicated user called ``carta`` for this purpose. The ``carta`` user should *not* be added to the ``carta-users`` group.

.. code-block:: shell

    # Create a group to identify CARTA users
    sudo groupadd carta-users

    # Create a 'carta' user to run the controller
    sudo useradd --system --create-home --home /var/lib/carta --shell=/bin/bash --user-group carta

    # Create a log directory owned by carta
    sudo mkdir -p /var/log/carta
    sudo chown carta: /var/log/carta

    # Create a config directory owned by carta
    sudo mkdir -p /etc/carta
    sudo chown carta: /etc/carta

.. _sbs_perms:

Set up permissions
~~~~~~~~~~~~~~~~~~

.. warning::

    If you are using PAM authentication of local users, the ``carta`` user needs read access to the shadow file. This step is not required if you are configuring a different form of user authentication (e.g. LDAP).

.. tabs::

    .. tab:: Ubuntu

        On Ubuntu by default the shadow file is group-owned by a shadow group which has read access. You only have to add the ``carta`` user to the group.

        .. code-block:: shell

            # Add 'carta' user to the shadow group
            sudo usermod -a --groups shadow carta

    .. tab:: AlmaLinux

        On AlmaLinux by default the shadow file is accessible only by root and has minimal permissions. You have to create a new ``shadow`` group for the ``carta`` user and modify the file's permissions to provide access.

        .. code-block:: shell

            # Create 'shadow' group
            sudo groupadd --system shadow

            # Change group ownership and permissions of the shadow file
            sudo chgrp shadow /etc/shadow
            sudo chmod g+r /etc/shadow

            # It's advisable to reboot before proceeding
            sudo reboot

            # Add 'carta' user to the shadow group
            sudo usermod -a --groups shadow carta

The ``carta`` user must be given permission to execute the CARTA backend and the script to kill the CARTA backend on behalf of CARTA users using ``sudo`` without providing a password.

.. code-block:: shell

    # Edit sudoers file to grant 'carta' user permission to execute
    # the backend and kill script as any user in `carta-users` group
    sudo visudo -f /etc/sudoers.d/carta_controller

An :ref:`example sudoers configuration<example_sudoers>` is provided in the configuration section. Make sure that the paths to the two executables in the file match their install locations on your system.

.. _sbs_webserver:

Configure webserver
-------------------

.. _sbs_nginx:

Install and configure Nginx
~~~~~~~~~~~~~~~~~~~~~~~~~~~

The CARTA controller requires a webserver. We provide instructions for `Nginx <https://www.nginx.com/>`_.

.. tabs::

    .. tab:: Ubuntu

        .. code-block:: shell

            # Install Nginx
            sudo apt-get install nginx

    .. tab:: AlmaLinux

        .. code-block:: shell

            # Install Nginx
            sudo dnf install nginx

            # Start Nginx
            sudo systemctl start nginx

            # Make Nginx start automatically
            sudo systemctl enable nginx

            # Configure SELinux
            sudo setsebool -P httpd_can_network_connect on

.. note::

    If you have also installed a firewall on your server, ensure that it allows both HTTP and HTTPS traffic.

.. _sbs_ssl:

Configure SSL
~~~~~~~~~~~~~

For security reasons, we strongly recommend configuring SSL on your server and redirecting all HTTP traffic to HTTPS. We provide instructions for obtaining certificates from `Let's Encrypt <https://letsencrypt.org>`_ using the `Certbot <https://certbot.eff.org/>`_ tool. Certbot will automatically renew your certificates for you. If your organisation can provide you with certificates for your domain, you can skip this step.

.. note::

    Let's Encrypt only issues certificates for publically resolvable domain names, so make sure that you have configured DNS appropriately before this point, and that Nginx is already running and serving its default index page over HTTP at your public domain.

.. tabs::

    .. tab:: Ubuntu

        .. code-block:: shell

            # Install certbot
            sudo apt-get install certbot python3-certbot-nginx

            # Run certbot and follow the prompts to generate the certificates
            # Note the certificate and key locations which are printed out
            sudo certbot certonly --nginx

        .. note::

            For simplicity we have provided instructions for installing Certbot from the Ubuntu repositories with ``apt``. However, these packages are far behind the latest version, particularly in older Ubuntu releases. The `official instructions <https://certbot.eff.org/instructions?ws=nginx&os=snap>`_ recommend installation via ``snap``.

    .. tab:: AlmaLinux

        .. code-block:: shell

            # Install certbot
            sudo dnf install certbot python3-certbot-nginx

            # Run certbot and follow the prompts to generate the certificates
            # Note the certificate and key locations which are printed out
            sudo certbot certonly --nginx

        .. note::

            For simplicity we have provided instructions for installing Certbot from the EPEL repositories with ``dnf``. However, these packages are far behind the latest version, particularly in older AlmaLinux releases. The `official instructions <https://certbot.eff.org/instructions?ws=nginx&os=snap>`_ recommend installation via ``snap``.

Once you have obtained the certificates, edit the Nginx configuration. A :ref:`sample configuration file<example_nginx>` is provided in the configuration section. Adjust the paths to the certificate and the certificate key, using the paths printed by ``certbot`` in the previous step.

.. code-block:: shell

    # Create an Nginx configuration file for CARTA
    sudo vim /etc/nginx/conf.d/carta.conf

    # Restart Nginx
    sudo systemctl restart nginx

.. _sbs_config_controller:

Configure CARTA controller
--------------------------

.. _sbs_config_basic:

Basic configuration
~~~~~~~~~~~~~~~~~~~

These configuration steps should be performed as the ``carta`` user. This user should own all the files in the ``/etc/carta`` directory.

The CARTA controller uses SSL keys for authentication.

.. code-block:: shell

    # Switch to carta user
    sudo su - carta

    # Generate private/public keys
    openssl genrsa -out /etc/carta/carta_private.pem 4096
    openssl rsa -in /etc/carta/carta_private.pem -outform PEM -pubout -out /etc/carta/carta_public.pem

Edit ``/etc/carta/config.json`` to customise the appearance of the dashboard and other controller options. We recommend configuring options for the backend in a separate ``/etc/carta/backend.json`` file.  We provide sample :ref:`controller<example_config>` and :ref:`backend<example_backend>` configuration files. Please refer to the :ref:`configuration` instructions for more details.

.. code-block:: shell

    # Create a controller configuration file
    vim /etc/carta/config.json

    # Create a global backend configuration file
    vim /etc/carta/backend.json

.. note::

    If you use ``/etc/carta/backend.json``, please ensure that it is readable by all users in the ``carta-users`` group, *and* that ``/etc/carta/`` is readable and executable by these users.

.. _sbs_config_test:

Test CARTA controller
~~~~~~~~~~~~~~~~~~~~~

To test that the controller is configured correctly, use the built-in test feature. You will need at least one user in the ``carta-users`` group.

.. code-block:: shell

    # Switch back to user with sudo access
    exit

    # Create a test user in the 'carta-users' group
    sudo useradd --create-home --groups carta-users alice
    sudo passwd alice

    # Switch to 'carta' user
    sudo su - carta

    # Run the controller test
    carta-controller --verbose --test alice

Please refer to the detailed configuration instructions for more information about the :ref:`test feature<test-config>`.

.. _sbs_config_start:

Start CARTA controller
~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: shell

    # Switch back to user with sudo access
    exit

    # Copy test image to user's home directory
    sudo cp /usr/share/carta/default.fits /home/alice/test.fits
    sudo chown alice: /home/alice/test.fits

    # Switch to carta user
    sudo su - carta

    carta-controller

You should now be able to navigate to your domain, log into CARTA with your test user's credentials, and open and view the test image.

.. note::

    In the example above, the default test image packaged with the CARTA backend is copied into the test user's home directory -- if you configured a different user directory structure, or installed a custom backend, please adjust these paths.

.. _sbs_config_autostart:

Configure autostart
~~~~~~~~~~~~~~~~~~~

The PM2 service will start the controller automatically after a reboot.

.. code-block:: shell

    # Switch to user with sudo access
    exit

    # Install PM2 process manager
    sudo npm install -g pm2

    # Switch to carta user
    sudo su - carta

    # Generate startup script
    pm2 startup

    # Switch back to user with sudo privileges
    exit

    # Execute the output of the 'pm startup' command

    # Switch back to the 'carta' user
    sudo su - carta

    # Start the controller
    pm2 start carta-controller

    # Save the running process
    pm2 save

Please refer to the `PM2 documentation <https://pm2.keymetrics.io/docs/usage/startup/>`_ for more detailed instructions.

.. _sbs_config_cleanup:

Clean up
~~~~~~~~

Once you have finished testing the controller, remove the test user.

.. code-block:: shell

    sudo userdel --remove alice
