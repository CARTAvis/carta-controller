.. _almalinux_instructions:

Step-by-step instructions for Almalinux 8.4
===========================================

.. note::

    These instructions should also work for RHEL8, CentOS8, and Rocky Linux. Some changes may be necessary for RHEL7/CenOS7.


1. Install Node.js
~~~~~~~~~~~~~~~~~~

carta-controller uses `Node.js <https://nodejs.org/>` and supports v12, v14, and v16. Node.js can easily be installed from the AlmaLinux AppStream repository. Here we install v14, as well as the `npm` package manager.

.. code-block:: shell

    sudo dnf module enable nodejs:14
    sudo dnf install -y nodejs npm
    # Check it is installed and working:
    node --version
    npm --version

2. Install MongoDB
~~~~~~~~~~~~~~~~~~

carta-controller uses `MongoDB <https://www.mongodb.com/>` to store user preferences etc. MongoDB is not available through the default AlmaLinux repositories, but we can create to custom repository file in order to easily install it:

.. code-block:: shell

    sudo cat <<EOT >> /etc/yum.repos.d/mongodb-org.repo
    [mongodb-org-4.4]
    name=MongoDB Repository
    baseurl=https://repo.mongodb.org/yum/redhat/$releasever/mongodb-org/4.4/x86_64/
    gpgcheck=1
    enabled=1
    gpgkey=https://www.mongodb.org/static/pgp/server-4.4.asc
    EOT

    sudo dnf update
    sudo dnf install -y mongodb-org
    
    # Start and enable MongoDB to run on startup
    sudo systemctl start mongod
    sudo systemctl enable mongod
    sudo systemctl status mongod

.. note::

    On RHEL7/CentOS7, MongoDB v14 can be installed as follows:
    ``curl -fsSL https://rpm.nodesource.com/setup_14.x | bash -``
    ``yum install -y nodejs``


3. Install carta-controller
~~~~~~~~~~~~~~~~~~~~~~~~~~~

The easiest way to install carta-controller is using ``npm``. 

.. code-block:: shell

    sudo dnf install -y python3 make gcc-c++
    sudo npm install -g --unsafe-perm carta-controller

.. note::

    The carta-controller executable will be installed at ``/usr/local/lib/node_modules/carta-controller``.
    The carta-frontend will be installed at ``/usr/local/lib/node_modules/carta-controller/node_modules/carta-frontend/build``.

.. note::
    
    Do not pass the ``--unsafe-perm`` flag to ``npm`` if using a local install.

.. note::
    Beta versions of carta-controller can be installed. For example, ``sudo npm install -g --unsafe-perm carta-controller-3.0.0-beta.1d``. 
    Available versions can be found `here https://www.npmjs.com/package/carta-controller>`_.

.. note::
    
    On RHEL7/CentOS7 the carta-controller package can not run with the default gcc version 4.8.5 (there would be an error due to ``node-linux-pam``). 
    A work around is to install a newer GCC version from source in order to get a newer ``libstdc++.so.6``. Then add the location of the newer 
    libstdc++.so.6 to the LD_LIBRARY_PATH. After that, carta-controller can run on RHEL7/CentOS7


4. Install the carta-backend component
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The easiest way may be to install the carta-backend is from our cartavis RPM repository.

.. code-block:: shell

    sudo curl https://packages.cartavis.org/cartavis-el8.repo --output /etc/yum.repos.d/cartavis.repo
    sudo dnf -y install 'dnf-command(config-manager)'
    sudo dnf -y install epel-release
    sudo dnf -y config-manager --set-enabled powertools
    sudo dnf -y install carta-backend

    # Check that the backend can run and is version 2.0.0
    /usr/bin/carta_backend --version


.. note::
    
    If you install the beta version of carta-controller, you need to install the beta version of the carta-backend ``sudo dnf -y install carta-backend-beta``.


5. Install Nginx
~~~~~~~~~~~~~~~~

carta-controller requires a webserver. Here we use `NGINX <https://www.nginx.com/>`, but Apache should work too.

.. code-block:: shell

    sudo dnf install -y nginx
    sudo systemctl start nginx
    sudo systemctl enable nginx
    sudo setsebool -P httpd_can_network_connect 1
    sudo firewall-cmd --permanent --zone=public --add-service=http
    sudo firewall-cmd --permanent --zone=public --add-service=https
    sudo firewall-cmd --reload

    # Generate private/public keys (optional if you do not already have SSL certificates)
    sudo mkdir /etc/carta
    cd /etc/carta
    sudo openssl genrsa -out carta_private.pem 4096
    sudo openssl rsa -in carta_private.pem -outform PEM -pubout -out carta_public.pem

    # Set up the nginx configuration file using our sample linked below
    sudo cd /etc/nginx/conf.d/
    sudo vi /etc/nginx/conf.d/carta.conf
    sudo systemctl restart nginx

    # Check it is running
    sudo systemctl status nginx

A :ref:`sample configuration file<example_nginx>` is provided in the configuration section. This should be adapted to your server configuration.

.. note::
    If there are problems, you can debug with ``journactl -xe`` and checking log files in ``/var/log/nginx/``.


6. Create the 'carta' user
~~~~~~~~~~~~~~~~~~~~~~~~~~

For security, we recommend not to run the carta-controller as the root user. Therefore we create a new user called ``carta`` and make part it part of a new group called ``carta-users``. We will allow any user in the ``carta-users`` group to run ``/usr/bin/carta_backend`` and the script to close the carta-backend; ``/usr/local/bin/carta-kill-script`` by adding a custom entry to the sudoers file.

.. code-block:: shell

    sudo adduser carta
    sudo groupadd carta-users
    sudo usermod -a -G carta-users carta
    # Check everything is OK
    id carta
    uid=1000(carta) gid=1000(carta) groups=1000(carta),1001(carta-users)

    # So that log files can be written:
    sudo mkdir -p /var/log/carta
    sudo chown -R carta /var/log/carta

    # Add the custom sudoers file entry using our sample linked below
    sudo visudo -f /etc/sudoers.d/carta_controller
    
An :ref:`example sudoers configuration<example_sudoers>` is provided in the configuration section.

.. note::
    The only safe way to modify sudoers is using `visudo`. Any syntax errors from directly editing sudoers could make your system unusable.


7. Set up the user authentication method
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

This is the most difficult step and depends how you authenticate users at your institute. 
In this step-by-step guide we use PAM authntication and local user, ``bob``, on the server running carta-controller.
Every user needs to be part of the ``carta-users`` group.
With PAM authentication, the ``carta`` user that runs carta-controller requires access to the ``/etc/shadow`` file in order to authenticate other users. We can enable this by creating a new group called ``shadow`` and assigning the ``/etc/shadow`` file to that group:

.. code-block:: shell

    # Create the test user 'bob'
    sudo useradd -G carta-users bob
    sudo passed bob

    # A new group called 'shadow' needs to be assinged to the /etc/shadow file and user 'carta'
    sudo groupadd shadow
    sudo chgrp shadow /etc/shadow
    sudo chmod g+r /etc/shadow
    sudo usermod -a -G shadow carta
    # ls -l should show permissions as ----r-----. 1 root shadow
    # It could be helpful to reboot the server at this point
    sudo reboot 


8. Configure the carta-controller config.json file
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Create and fill in the `config.json` using our sample file :ref:`sample configuration file<example_config>`. 

.. code-block:: shell
    sudo mkdir /etc/carta
    sudo chown -R carta /etc/carta
    vi /etc/carta/config.json

Please check the `CARTA Configuration Schema <https://carta-controller.readthedocs.io/en/latest/schema.html#schema>` for all available options.


9. Check everything is working
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Here we switch to the ``carta`` user and test the carta-controller with our test user ``bob``:

.. code-block:: shell
    su - carta
    carta-controller -v -t bob

If the test is successful, carta-controller should be ready to deploy.


10. Set up carta-controller to run with pm2
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

`pm2 <https://pm2.keymetrics.io/>` is a very convenient tool to keep the carta-controller service running in the background, and even start it up automatically after a reboot.

.. code-block:: shell
    sudo npm install -g pm2
    su -carta
    pm2 start carta-controller

Please refer to the `pm2 documentation <https://pm2.keymetrics.io/docs/usage/startup/>`_ for detailed instructions.

Now your users should be able to access your server's URL and log into CARTA.

