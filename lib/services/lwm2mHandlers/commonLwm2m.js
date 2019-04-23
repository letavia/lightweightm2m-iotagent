/*
 * Copyright 2014 Telefonica Investigación y Desarrollo, S.A.U
 *
 * This file is part of lightweightM2M-iotagent
 *
 * lightweightM2M-iotagent is free software: you can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the License,
 * or (at your option) any later version.
 *
 * lightweightM2M-iotagent is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public
 * License along with lightweightM2M-iotagent.
 * If not, seehttp://www.gnu.org/licenses/.
 *
 * For those usages not covered by the GNU Affero General Public License
 * please contact with::[contacto@tid.es]
 *
 * Modified by: Daniel Calvo - ATOS Research & Innovation
 */
'use strict';

var iotAgentLib = require('iotagent-node-lib'),
    lwm2mLib = require('lwm2m-node-lib').server,
    omaInverseRegistry = require('../../../omaInverseRegistry.json'),
    lwm2mUtils = require('../../lwm2mUtils'),
    logger = require('logops'),
    async = require('async'),
    apply = async.apply,
    commons = require('../../commons'),
    context = {
        op: 'IOTAgent.LWM2MHandlers'
    };

/**
 * Handle incoming information from an active attribute of the LWM2M device in the southbound.
 *
 * @param {Object} registeredDevice         LWM2M Device sending the information.
 * @param {String} name                     Name of the attribute to update.
 * @param {String} type                     Type of the attribute to update.
 * @param {String} value                    New value for the attribute.
 */
function activeDataHandler(registeredDevice, name, type, value) {
    var attributes = [
        {
            name: name,
            type: type,
            value: value
        }
    ];

    logger.debug(context, 'Handling data from device [%s]', registeredDevice.id);

    iotAgentLib.update(
        registeredDevice.name,
        registeredDevice.type,
        '',
        attributes,
        registeredDevice,
        function handleUpdateEntity(error) {
            if (error) {
                logger.error(context, 'Unknown error connecting with the Context Broker: ' + error);
            } else {
                logger.debug(context, 'Data handled successfully');
            }
        }
    );
}

/**
 * Given a registered device,a OMA Object and the corresponding active attribute, creates an observer for the resource
 * associated with that kind of device.
 *
 * @param  {Object} registeredDevice
 * @param  {Object} lwm2mMapping
 * @param  {Object} activeAttribute
 * @param  {Function} activeDataHandler
 * @param  {Function} callback
 */
function observeActiveAttribute(registeredDevice, lwm2mMapping, activeAttribute, activeDataHandler, callback) {
    lwm2mLib.observe(
        registeredDevice.internalId,
        lwm2mMapping.objectType,
        lwm2mMapping.objectInstance,
        lwm2mMapping.objectResource,
        apply(activeDataHandler, registeredDevice, activeAttribute.name, activeAttribute.type),
        function(err, data) {
            if (err) {
                return callback(err);
            } else {
                activeDataHandler(registeredDevice, activeAttribute.name, activeAttribute.type, data);
                return callback();
            }
        }
    );
}

/**
 * Given a registered device and a text payload indicating a list of the OMA Objects supported by a client, creates an
 * observer for each active resource associated with that kind of device.
 *
 * @param {String} payload              Text representation of the list of objects supported by the client.
 * @param {Object} registeredDevice     Object representing the LWM2M device data.
 */
function observeActiveAttributes(payload, registeredDevice, callback) {
    var objects = lwm2mUtils.parseObjectUriList(payload),
        activeAttributes = [],
        observationList = [];

    if (registeredDevice.active) {
        activeAttributes = registeredDevice.active;
        logger.debug('active status: ' + registeredDevice.active);
    } else if (commons.getConfig().ngsi.types[registeredDevice.type]) {
        activeAttributes = commons.getConfig().ngsi.types[registeredDevice.type].attributes;
    }

    for (var i = 0; i < activeAttributes.length; i++) {
        var lwm2mMapping = {};

        var attName;

        if (iotAgentLib.configModule.checkNgsi2()) {
            attName = decodeURI(activeAttributes[i].name);
        } else {
            attName = activeAttributes[i].name;
        }

        if (
            registeredDevice.internalAttributes &&
            registeredDevice.internalAttributes.lwm2mResourceMapping &&
            registeredDevice.internalAttributes.lwm2mResourceMapping[attName]
        ) {
            lwm2mMapping = registeredDevice.internalAttributes.lwm2mResourceMapping[attName];
        } else if (commons.getConfig().ngsi.types[registeredDevice.type]) {
            lwm2mMapping = commons.getConfig().ngsi.types[registeredDevice.type].lwm2mResourceMapping[attName];
        } else if (omaInverseRegistry[attName]) {
            lwm2mMapping = omaInverseRegistry[attName];

            if (!lwm2mMapping.objectInstance) {
                lwm2mMapping.objectInstance = 0;
            }
        } else {
            /*jshint quotmark: double */
            callback("Couldn't find any way to map the active attribute: " + activeAttributes[i].name);
            /*jshint quotmark: single */
            return;
        }

        if (lwm2mMapping) {
            var mappedUri = '/' + lwm2mMapping.objectType + '/' + lwm2mMapping.objectInstance;

            for (var j = 0; j < objects.length; j++) {
                if (mappedUri === objects[j]) {
                    observationList.push(
                        apply(
                            observeActiveAttribute,
                            registeredDevice,
                            lwm2mMapping,
                            activeAttributes[i],
                            activeDataHandler
                        )
                    );
                }
            }
        }
    }

    setTimeout(function() {
        async.series(observationList, function(error) {
            if (error) {
                logger.error('Could not complete the observer creation processes due to the following error: ' + error);
            } else {
                logger.debug('Observers created successfully.');
            }
        });
    }, commons.getConfig().lwm2m.delayedObservationTimeout || 50);

    callback(null);
}

exports.observeActiveAttributes = observeActiveAttributes;
