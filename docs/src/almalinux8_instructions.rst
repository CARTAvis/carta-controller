.. _almalinux8_instructions:

Step-by-step instructions for AlmaLinux 8 and 9
===============================================

.. note::

    These instructions aim to be a complete guide for installing a multi-user CARTA system on a dedicated server, with authentication of local users via PAM, and other simple suggested defaults. If you need to integrate CARTA into an existing system, please refer to the more detailed :ref:`installation` and :ref:`configuration` instructions for more options.

.. note::

    CARTA version 4.x and 5.x are both supported on AlmaLinux 8 and 9. These instructions should also work on other equivalent RPM-based distributions.
    
    We also support legacy installations of CARTA 4.x on RHEL 7 and CentOS 7, but as both of these releases have reached end of life and are widely unsupported, we do not recommend using them for new installations. Adapting these instructions to these releases requires multiple workarounds, which are outside the scope of this document.
    
Dependencies
------------

Install MongoDB
~~~~~~~~~~~~~~~

We recommend installing the [Community Edition package of MongoDB](https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-red-hat/) on all supported RPM-based distributions. These are instructions for installing version 8.0, which is available on AlmaLinux 8 and 9.

.. code-block:: shell
    
    # Add MongoDB repository
    sudo cat <<EOT >> /etc/yum.repos.d/mongodb-org.repo
    [mongodb-org-8.0]
    name=MongoDB Repository
    baseurl=https://repo.mongodb.org/yum/redhat/$releasever/mongodb-org/8.0/$basearch/
    gpgcheck=1
    enabled=1
    gpgkey=https://www.mongodb.org/static/pgp/server-8.0.asc
    EOT

    sudo dnf update

    # Install MongoDB:
    sudo dnf install mongodb-org
    
    # Start MongoDB
    sudo systemctl start mongod
    
    # Make MongoDB start automatically on system restart
    sudo systemctl enable mongod
    
Please refer to the `detailed MongoDB installation instructions <https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/>`_ for more information.

Install the CARTA backend and other required packages
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The easiest way is to install the CARTA backend is from our `cartavis/carta Copr <https://copr.fedorainfracloud.org/coprs/cartavis/carta/>`_ repository.

.. code-block:: shell
    # Install EPEL repository
    sudo dnf install epel-release

    # Install the CARTA backend
    sudo dnf install 'dnf-command(copr)'
    sudo dnf copr enable cartavis/carta
    sudo dnf install carta-backend

    # Install additional packages
    
    sudo dnf install nginx
    sudo dnf install nginx python3 make curl gcc-c++
    
.. note::
    The ``carta-backend`` package is updated with every stable CARTA release. If you would like to install the latest **beta** version of CARTA, or to receive beta release updates as well as stable release updates in the future, please install ``carta-backend-beta`` instead:
    
    .. code-block:: shell
    
        sudo dnf install carta-backend-beta
    
    
    We currently install the beta version of ``carta_backend`` in a non-standard, ``/opt/carta-beta/``. This makes it possible to install the stable and beta packages simultaneously. To use the beta backend, specify the full path to the executable in the :ref:`controller configuration<config-controller-rpm>`.

    Make sure that you install the matching controller version (using the ``beta`` tag).
    
Install Node.js
~~~~~~~~~~~~~~~

Node.js can be installed from the AlmaLinux AppStream repository on AlmaLinux 8 and 9. We recommend using the `latest LTS version <https://github.com/nodejs/release#release-schedule>`_. The minimum version required for CARTA 5.x is v20. The oldest version known to work with CARTA 4.x is v16. In the example below we install v22.

.. code-block:: shell

    # Install Node.js and NPM
    sudo dnf module enable nodejs:22
    sudo dnf install nodejs npm

    # Install PM2 process manager
    sudo npm install -g pm2
    
Alternatively, Node.js can be installed from the `NodeSource repository <https://github.com/nodesource/distributions>`_.

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

Ensure that all users who should have access to CARTA belong to a group that identifies them (assumed here to be called ``carta-users``).

For security reasons, we do not recommend running the CARTA controller as the root user. Instead, we create a dedicated user called ``carta`` with limited permissions to run the CARTA backend and the script to kill the CARTA backend on behalf of CARTA users. The ``carta`` user should *not* be added to the ``carta-users`` group.

.. code-block:: shell

    # Create a 'carta' user to run the controller
    sudo adduser --system --home /var/lib/carta --shell=/bin/bash --group carta
    
    # Create a log directory owned by carta
    sudo mkdir -p /var/log/carta
    sudo chown carta: /var/log/carta

    # Create a config directory owned by carta
    sudo mkdir -p /etc/carta
    sudo chown carta: /etc/carta

Set up permissions and keys
~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. warning::

    If you are using PAM authentication of local users, the ``carta`` user needs read access to the shadow file. This step is not required if you are configuring a different form of user authentication (e.g. LDAP).

On AlmaLinux by default the shadow file is accessible only by root and has minimal permissions. We have to create a new ``shadow`` group for the ``carta`` user and modify the file's permissions to provide access. 

.. code-block:: shell

    # Create 'shadow' group
    sudo groupadd shadow
    
    # Change group ownership and permissions of the shadow file
    sudo chgrp shadow /etc/shadow
    sudo chmod g+r /etc/shadow
    
    # It's advisable to reboot before proceeding
    sudo reboot 
    
    # Add 'carta' user to the shadow group
    sudo usermod -a -G shadow carta
    
The ``carta`` user must be given permission to execute the CARTA backend and the script to kill the CARTA backend on behalf of CARTA users using ``sudo`` without providing a password.
    
.. code-block:: shell

    # Edit sudoers file to grant `carta` user permission to execute
    # the backend and kill script as any user in `carta-users` group
    sudo visudo -f /etc/sudoers.d/carta_controller

An :ref:`example sudoers configuration<example_sudoers>` is provided in the configuration section. Make sure that the paths to the two executables in the file match their install locations on your system.

.. note::

    If you have installed the **beta** version of CARTA, remember to change the path to the ``carta_backend`` executable in the sudoers file:
    
    .. code-block:: bash
    
        carta ALL=(%carta-users) NOPASSWD:SETENV: /opt/carta-beta/bin/carta_backend
    
The CARTA controller uses SSL keys for authentication.

.. code-block:: shell
    
    # Switch to carta user
    sudo su - carta
    
    # Generate private/public keys
    cd /etc/carta
    openssl genrsa -out carta_private.pem 4096
    openssl rsa -in carta_private.pem -outform PEM -pubout -out carta_public.pem

Configure Nginx and SSL certificates
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The CARTA controller requires a webserver. We provide instructions for `Nginx <https://www.nginx.com/>`_.

.. code-block:: shell

    # Start Nginx
    sudo systemctl start nginx
    
    # Make Nginx start automatically
    sudo systemctl enable nginx
    
    # Configure firewall
    sudo setsebool -P httpd_can_network_connect 1
    sudo firewall-cmd --permanent --zone=public --add-service=http
    sudo firewall-cmd --permanent --zone=public --add-service=https
    sudo firewall-cmd --reload

For security reasons, we strongly recommend configuring HTTPS on your server and redirecting all HTTP traffic to HTTPS. We provide instructions for obtaining certificates from `Let's Encrypt <https://letsencrypt.org>`_ using the `Certbot <https://certbot.eff.org/>`_ tool. Certbot will automatically renew your certificates for you.

Let's Encrypt only issues certificates for publically resolvable domain names, so make sure that you have configured DNS appropriately before this point, and that Nginx is already running.

.. code-block:: shell
    # Install snap
    sudo dnf install snapd
    sudo systemctl enable --now snapd.socket
    sudo ln -s /var/lib/snapd/snap /snap

    # Either log out and back in or restart to update snap's paths
    
    # Install certbot
    sudo snap install --classic certbot
    sudo ln -s /snap/bin/certbot /usr/bin/certbot
    
    # Run certbot and follow the prompts to generate the certificates
    sudo certbot certonly --nginx

For more detailed instructions, please refer to the `Certbot documentation <https://certbot.eff.org/instructions?ws=nginx&os=snap>`_.
    
.. note::

    Certbot can also be installed from the EPEL repositories with `dnf`. However, these packages are much older, particularly in older AlmaLinux releases. The officially recommended installation method is via `snap`.
    
Once you have obtained the certificates, edit the Nginx configuration. A :ref:`sample configuration file<example_nginx>` is provided in the configuration section. Adjust the paths to the certificate and the certificate key.    

.. code-block:: shell

    # Edit the Nginx configuration for CARTA
    sudo vi /etc/nginx/conf.d/carta.conf
    
    # Restart Nginx
    sudo systemctl restart nginx

A :ref:`sample configuration file<example_nginx>` is provided in the configuration section. This should be adapted to your server configuration.

.. _config-controller_rpm:

Configure CARTA controller
~~~~~~~~~~~~~~~~~~~~~~~~~~

Edit ``/etc/carta/config.json`` to customise the appearance of the dashboard and other options. A :ref:`sample configuration file<example_config>` is provided in the configuration section.

Run CARTA controller
~~~~~~~~~~~~~~~~~~~~

.. code-block:: shell
    
    # Switch to carta user
    sudo su - carta

    pm2 start carta-controller

Configure CARTA controller service
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

This service will start the controller automatically after a reboot. Please refer to the `PM2 documentation <https://pm2.keymetrics.io/docs/usage/startup/>`_ for detailed instructions. You should run ``pm2 startup`` as ``carta``, execute the generated command as a user with ``sudo`` access, and finally run ``pm2 save`` as ``carta`` to save the running controller process.
